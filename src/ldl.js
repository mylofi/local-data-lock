import {
	supportsWebAuthn,
	regDefaults,
	register,
	authDefaults,
	auth,
	verifyAuthResponse,
	packPublicKeyJSON,
	unpackPublicKeyJSON,
	toBase64String,
	fromBase64String,
	toUTF8String,
	fromUTF8String,
	resetAbortReason,
} from "@lo-fi/webauthn-local-client";


// ***********************

const CURRENT_LOCK_KEY_FORMAT_VERSION = 1;
const IV_BYTE_LENGTH = sodium.crypto_sign_SEEDBYTES;
var MAX_LOCK_KEY_CACHE_LIFETIME = setMaxLockKeyCacheLifetime();
var DEFAULT_STORAGE_TYPE = "idb";
var store = null;
var localIdentities = null;
var lockKeyCache = {};
var abortToken = null;
var externalSignalCache = new WeakMap();


// ***********************

export {
	// re-export WebAuthn-Local-Client helper utilities:
	supportsWebAuthn,
	packPublicKeyJSON,
	unpackPublicKeyJSON,
	toBase64String,
	fromBase64String,
	toUTF8String,
	fromUTF8String,
	resetAbortReason,

	// main library API:
	listLocalIdentities,
	clearLockKeyCache,
	removeLocalAccount,
	getLockKey,
	generateEntropy,
	deriveLockKey,
	lockData,
	unlockData,
	setMaxLockKeyCacheLifetime,
	configureStorage,
};
var publicAPI = {
	// re-export WebAuthn-Local-Client helper utilities:
	supportsWebAuthn,
	packPublicKeyJSON,
	unpackPublicKeyJSON,
	toBase64String,
	fromBase64String,
	toUTF8String,
	fromUTF8String,
	resetAbortReason,

	// main library API:
	listLocalIdentities,
	clearLockKeyCache,
	removeLocalAccount,
	getLockKey,
	generateEntropy,
	deriveLockKey,
	lockData,
	unlockData,
	setMaxLockKeyCacheLifetime,
	configureStorage,
};
export default publicAPI;


// ***********************

async function listLocalIdentities() {
	await checkStorage();
	return Object.keys(localIdentities);
}

function getCachedLockKey(localID) {
	var now = Date.now();
	if (
		// lock-key currently in cache?
		(localID in lockKeyCache) &&

		// ... and not expired yet?
		lockKeyCache[localID].timestamp >= (
			now - Math.min(MAX_LOCK_KEY_CACHE_LIFETIME,now)
		)
	) {
		// discard cache-internal timestamp field
		let { timestamp, ...lockKey } = lockKeyCache[localID];
		return lockKey;
	}
}

function cacheLockKey(localID,lockKey,forceUpdate = false) {
	if (!(localID in lockKeyCache) || forceUpdate) {
		lockKeyCache[localID] = {
			...lockKey,

			// cache-internal timestamp field, for recency
			// expiration check
			timestamp: Date.now(),
		};
	}
}

function clearLockKeyCache(localID) {
	if (localID != null) {
		delete lockKeyCache[localID]
	}
	else {
		lockKeyCache = {};
	}
}

async function removeLocalAccount(localID) {
	await checkStorage();
	delete lockKeyCache[localID];
	delete localIdentities[localID];
	return storeLocalIdentities();
}

async function getLockKey(
	{
		localIdentity: localID = toBase64String(generateEntropy(15)),
		username = "local-user",
		displayName = "Local User",
		relyingPartyID = document.location.hostname,
		relyingPartyName = "Local Data Lock",
		addNewPasskey = false,
		resetLockKey = false,
		useLockKey = null,
		verify = true,
		signal: cancelLockKey,
	} = {},
) {
	// local-identity already registered?
	await checkStorage();
	var identityRecord = localID != null ? localIdentities[localID] : null;
	if (identityRecord != null) {
		// lock-key already in cache?
		let lockKey = getCachedLockKey(localID);
		if (lockKey != null && !resetLockKey) {
			if (addNewPasskey) {
				resetAbortToken(cancelLockKey);

				let { record, } = (await registerLocalIdentity(lockKey)) || {};

				cleanupExternalSignalHandler(abortToken);
				abortToken = null;

				// new passkey registration succeeded?
				if (record != null) {
					identityRecord.lastSeq = record.lastSeq;
					identityRecord.passkeys = [
						...identityRecord.passkeys,
						...record.passkeys
					];
					await storeLocalIdentities();
				}
			}

			// return cached lock-key info
			return Object.freeze({
				...lockKey,
				localIdentity: localID,
			});
		}
		else {
			// remove expired cache entry (if any)
			delete lockKeyCache[localID];

			// create (or import) new lock-key (and passkey)?
			if (resetLockKey) {
				resetAbortToken(cancelLockKey);

				// throw away previous identity record (including
				// previous passkeys) and replace with this new
				// identity record and passkey
				({
					record: localIdentities[localID],
					lockKey,
				} = (await registerLocalIdentity(
					// manually importing an external lock-key?
					useLockKey && typeof useLockKey == "object" ?
						checkLockKey(useLockKey) :
						undefined
				))) || {};

				cleanupExternalSignalHandler(abortToken);
				abortToken = null;

				// registration failed?
				if (localIdentities[localID] == null) {
					delete localIdentities[localID];
				}
				// registration succeeded, lock-key returned?
				else if (lockKey != null) {
					await storeLocalIdentities();
					cacheLockKey(localID,lockKey);

					return Object.freeze({
						...lockKey,
						localIdentity: localID,
					});
				}
			}
			// auth with existing passkey (and cache resulting lock-key)?
			else if (!addNewPasskey) {
				resetAbortToken(cancelLockKey);

				let authOptions = authDefaults({
					relyingPartyID,
					mediation: "optional",
					allowCredentials: (
						identityRecord.passkeys.map(({ credentialID, }) => ({
							type: "public-key",
							id: credentialID,
						}))
					),
					signal: abortToken.signal,
				});
				let authResult = await auth(authOptions);

				cleanupExternalSignalHandler(abortToken);
				abortToken = null;

				// authentication succeeded?
				if (authResult != null) {
					// verify auth result?
					if (verify) {
						let passkey = identityRecord.passkeys.find(passkey => (
							passkey.credentialID == authResult.response.credentialID
						));
						let publicKey = (passkey != null) ? passkey.publicKey : null;
						let verified = (
							(publicKey != null) ? await verifyAuthResponse(authResult.response,publicKey) : false
						);
						if (!verified) {
							throw new Error("Auth verification failed");
						}
					}

					return {
						...extractLockKey(authResult),
						localIdentity: localID,
					};
				}
			}
			else {
				throw new Error("Encryption/Decryption key not currently cached, unavailable for new passkey");
			}
		}
	}
	// attempt auth (with existing discoverable passkey) to extract
	// (and cache!) existing lock-key?
	else if (!addNewPasskey) {
		resetAbortToken(cancelLockKey);
		let authOptions = authDefaults({
			relyingPartyID,
			mediation: "optional",
			signal: abortToken.signal,
		});
		let authResult = await auth(authOptions);

		cleanupExternalSignalHandler(abortToken);
		abortToken = null;

		// authentication succeeded?
		if (authResult != null) {
			let lockKey = extractLockKey(authResult);

			// find matching local-identity (if any)
			let [ matchingLocalID, ] = (
				Object.entries(localIdentities)
				.find(([ , record, ]) => (
					record.passkeys.find(passkey => (
						// matching credential used for authentication?
						passkey.credentialID == authResult.response.credentialID
					)) != null
				))
			) || [];
			// discard auto-generated local-id, use matching local-id?
			if (matchingLocalID != null) {
				delete lockKeyCache[localID];
				localID = matchingLocalID;
				identityRecord = localIdentities[localID];

				// verify auth result?
				if (verify) {
					let passkey = identityRecord.passkeys.find(passkey => (
						passkey.credentialID == authResult.response.credentialID
					));
					let publicKey = (passkey != null) ? passkey.publicKey : null;
					let verified = (
						(publicKey != null) ? await verifyAuthResponse(authResult.response,publicKey) : false
					);
					if (!verified) {
						throw new Error("Auth verification failed");
					}
				}

				cacheLockKey(localID,lockKey);
			}
			else if (verify) {
				throw new Error("Auth verification requested but skipped, against unrecognized passkey (no matching local-identity)");
			}

			return Object.freeze({
				...lockKey,
				localIdentity: localID,
			});
		}
	}
	// new local-identity needs initial registration
	else {
		resetAbortToken(cancelLockKey);
		let { record, lockKey, } = (await registerLocalIdentity(
			// manually importing an external lock-key?
			useLockKey && typeof useLockKey == "object" ?
				checkLockKey(useLockKey) :
				undefined
		)) || {};

		cleanupExternalSignalHandler(abortToken);
		abortToken = null;

		// registration succeeded, lock-key returned?
		if (record != null && lockKey != null) {
			localIdentities[localID] = record;
			cacheLockKey(localID,lockKey);
			await storeLocalIdentities();

			return Object.freeze({
				...lockKey,
				localIdentity: localID,
			});
		}
	}


	// ***********************

	async function registerLocalIdentity(lockKey = deriveLockKey()) {
		try {
			let identityRecord = localIdentities[localID];
			let lastSeq = ((identityRecord || {}).lastSeq || 0) + 1;

			// note: encode the userHandle field of the passkey with the
			// first 32 bytes of the keypair IV, and then 2 bytes
			// to encode (big-endian) a passkey sequence value; this
			// additional value allows multiple passkeys (up to 65,535 of
			// them) registered on the same authenticator, sharing the same
			// lock-keypair IV in its userHandle
			let userHandle = new Uint8Array(lockKey.iv.byteLength + 2);
			let seqBytes = new DataView(new ArrayBuffer(2));
			seqBytes.setInt16(0,lastSeq,/*littleEndian=*/false);
			userHandle.set(lockKey.iv,0);
			userHandle.set(new Uint8Array(seqBytes.buffer),lockKey.iv.byteLength);

			let regOptions = regDefaults({
				relyingPartyID,
				relyingPartyName,
				user: {
					id: userHandle,
					name: username,
					displayName,
				},
				signal: abortToken.signal,
			});
			let regResult = await register(regOptions);

			if (regResult != null) {
				return {
					record: {
						lastSeq,
						passkeys: [
							buildPasskeyEntry({
								seq: lastSeq,
								credentialID: regResult.response.credentialID,
								publicKey: regResult.response.publicKey,
							}),
						],
					},
					lockKey,
				};
			}
		}
		catch (err) {
			throw new Error("Identity/Passkey registration failed",{ cause: err, });
		}
	}

	function extractLockKey(authResult) {
		try {
			if (
				authResult &&
				authResult.response &&
				isByteArray(authResult.response.userID) &&
				authResult.response.userID.byteLength == (IV_BYTE_LENGTH + 2)
			) {
				let lockKey = deriveLockKey(
					authResult.response.userID.subarray(0,IV_BYTE_LENGTH)
				);
				cacheLockKey(localID,lockKey);
				return lockKey;
			}
			else {
				throw new Error("Passkey info missing");
			}
		}
		catch (err) {
			throw new Error("Chosen passkey did not provide a valid encryption/decryption key",{ cause: err, });
		}
	}
}

function resetAbortToken(externalSignal) {
	// previous attempt still pending?
	if (abortToken) {
		cleanupExternalSignalHandler(abortToken);

		if (!abortToken.aborted) {
			abortToken.abort("Passkey operation abandoned.");
		}
	}
	abortToken = new AbortController();

	// new external abort-signal passed in, to chain
	// off of?
	if (externalSignal != null) {
	    // signal already aborted?
		if (externalSignal.aborted) {
			abortToken.abort(externalSignal.reason);
		}
		// listen to future abort-signal
		else {
			let handlerFn = () => {
				cleanupExternalSignalHandler(abortToken);
				abortToken.abort(externalSignal.reason);
				abortToken = externalSignal = handlerFn = null;
			};
			externalSignal.addEventListener("abort",handlerFn);
			externalSignalCache.set(abortToken,[ externalSignal, handlerFn, ]);
		}
	}
}

function cleanupExternalSignalHandler(token) {
	// controller previously attached to an
	// external abort-signal?
	if (token != null && externalSignalCache.has(token)) {
		let [ prevExternalSignal, handlerFn, ] = externalSignalCache.get(token);
		prevExternalSignal.removeEventListener("abort",handlerFn);
		externalSignalCache.delete(token);
	}
}

function generateEntropy(numBytes = 16) {
	return sodium.randombytes_buf(numBytes);
}

function deriveLockKey(iv = generateEntropy(IV_BYTE_LENGTH)) {
	try {
		let ed25519KeyPair = sodium.crypto_sign_seed_keypair(iv);
		return {
			keyFormatVersion: CURRENT_LOCK_KEY_FORMAT_VERSION,
			iv,
			publicKey: ed25519KeyPair.publicKey,
			privateKey: ed25519KeyPair.privateKey,
			encPK: sodium.crypto_sign_ed25519_pk_to_curve25519(
				ed25519KeyPair.publicKey,
			),
			encSK: sodium.crypto_sign_ed25519_sk_to_curve25519(
				ed25519KeyPair.privateKey,
			),
		};
	}
	catch (err) {
		throw new Error("Encryption/decryption key derivation failed.",{ cause: err, });
	}
}

function checkLockKey(lockKeyCandidate) {
	if (
		lockKeyCandidate &&
		typeof lockKeyCandidate == "object"
	) {
		// assume current format key?
		if (lockKeyCandidate.keyFormatVersion === CURRENT_LOCK_KEY_FORMAT_VERSION) {
			return lockKeyCandidate;
		}
		// contains a suitable `iv` we can derive from?
		else if (
			isByteArray(lockKeyCandidate.iv) &&
			lockKeyCandidate.iv.byteLength == IV_BYTE_LENGTH
		) {
			return deriveLockKey(lockKeyCandidate.iv);
		}
	}
	throw new Error("Unrecongnized lock-key");
}

function lockData(
	data,
	lockKey,
	/*options=*/{
		outputFormat = "base64",		// "base64", "raw"
	} = {}
) {
	try {
		let dataBuffer = (
			// null/undefined?
			data == null ? null :

			// raw array buffer?
			data instanceof ArrayBuffer ? new Uint8Array(data) :

			// already uint8 byte array?
			isByteArray(data) ? data :

			// encode text to uint8 buffer
			fromUTF8String(
				// JSON-compatible object (hopefully)?
				typeof data == "object" ? JSON.stringify(data) :

				// already a string?
				typeof data == "string" ? data :

				// some other value type that needs to be
				// stringified
				String(data)
			)
		);
		if (data == null) {
			throw new Error("Non-empty data required.");
		}
		let encData = sodium.crypto_box_seal(dataBuffer,lockKey.encPK);
		return (
			[ "base64", "base-64", ].includes(outputFormat.toLowerCase()) ?
				toBase64String(encData) :
				encData
		);
	}
	catch (err) {
		throw new Error("Data encryption failed.",{ cause: err, });
	}
}

function unlockData(
	encData,
	lockKey,
	/*options=*/{
		outputFormat = "utf8",		// "utf8", "raw"
		parseJSON = true,
	} = {}
) {
	try {
		let dataBuffer = sodium.crypto_box_seal_open(
			(
				typeof encData == "string" ? fromBase64String(encData) :
				encData
			),
			lockKey.encPK,
			lockKey.encSK
		);

		if ([ "utf8", "utf-8", ].includes(outputFormat.toLowerCase()))  {
			let decodedData = toUTF8String(dataBuffer);
			return (
				parseJSON ? JSON.parse(decodedData) : decodedData
			);
		}
		else {
			return dataBuffer;
		}
	}
	catch (err) {
		throw new Error("Data decryption failed.",{ cause: err, });
	}
}

async function loadLocalIdentities() {
	return (
		Object.fromEntries(
			Object.entries(
				(await store.get("local-identities")) || {}
			)
			// only accept well-formed local-identity entries
			.filter(([ localID, entry, ]) => (
				typeof entry.lastSeq == "number" &&
				Array.isArray(entry.passkeys) &&
				entry.passkeys.length > 0 &&
				entry.passkeys.every(passkey => (
					typeof passkey.credentialID == "string" &&
					passkey.credentialID != "" &&
					typeof passkey.seq == "number" &&
					passkey.publicKey != null &&
					typeof passkey.publicKey == "object" &&
					typeof passkey.publicKey.algoCOSE == "number" &&
					typeof passkey.publicKey.raw == "string" &&
					passkey.publicKey.raw != "" &&
					typeof passkey.publicKey.spki == "string" &&
					passkey.publicKey.spki != "" &&
					typeof passkey.hash == "string" &&
					passkey.hash != "" &&
					passkey.hash == computePasskeyEntryHash(passkey)
				))
			))
			// unpack passkey public-keys
			.map(([ localID, entry, ]) => ([
				localID,
				{
					...entry,
					passkeys: entry.passkeys.map(passkey => ({
						...passkey,
						publicKey: unpackPublicKeyJSON(passkey.publicKey),
					}))
				},
			]))
		)
	);
}

async function storeLocalIdentities() {
	await checkStorage();

	var identities = Object.fromEntries(
		Object.entries(localIdentities)
		.map(([ localID, entry, ]) => ([
			localID,
			{
				...entry,
				passkeys: entry.passkeys.map(passkey => ({
					...passkey,
					publicKey: packPublicKeyJSON(passkey.publicKey),
				}))
			},
		]))
	);

	if (Object.keys(identities).length > 0) {
		await store.set("local-identities",identities);
	}
	else {
		await store.remove("local-identities");
	}
}

function setMaxLockKeyCacheLifetime(
	ms = 30 * 60 * 1000			// 30 min (default)
) {
	return (MAX_LOCK_KEY_CACHE_LIFETIME = Math.max(0,Number(ms) || 0));
}

function isByteArray(val) {
	return (
		val instanceof Uint8Array && val.buffer instanceof ArrayBuffer
	);
}

function buildPasskeyEntry(passkey) {
	return {
		...passkey,
		hash: computePasskeyEntryHash(passkey),
	};
}

function computePasskeyEntryHash(passkeyEntry) {
	let { hash: _, ...passkey } = passkeyEntry;
	return toBase64String(sodium.crypto_hash(JSON.stringify({
		...passkey,
		publicKey: packPublicKeyJSON(passkey.publicKey),
	})));
}

function configureStorage(storageType) {
	if ([ "idb", "local-storage", "session-storage", "cookie", "opfs", ].includes(storageType)) {
		DEFAULT_STORAGE_TYPE = storageType;
	}
	else {
		throw new Error(`Unrecognized storage type ('${storageType}')`);
	}
}

async function checkStorage() {
	if (store == null) {
		store = await import(`@lo-fi/client-storage/${DEFAULT_STORAGE_TYPE}`);
	}
	if (store != null && localIdentities == null) {
		localIdentities = await loadLocalIdentities();
	}
}
