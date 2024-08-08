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

const IV_BYTE_LENGTH = sodium.crypto_sign_SEEDBYTES;
var MAX_CRYPTO_KEY_CACHE_LIFETIME = setMaxCryptoKeyCacheLifetime();
var localIdentities = loadLocalIdentities();
var cryptoKeyCache = {};
var abortToken = null;


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

	// main library API:
	listLocalIdentities,
	clearCryptoKeyCache,
	removeLocalAccount,
	getCryptoKey,
	generateEntropy,
	deriveCryptoKey,
	lockData,
	unlockData,
	setMaxCryptoKeyCacheLifetime,
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

	// main library API:
	listLocalIdentities,
	clearCryptoKeyCache,
	removeLocalAccount,
	getCryptoKey,
	generateEntropy,
	deriveCryptoKey,
	lockData,
	unlockData,
	setMaxCryptoKeyCacheLifetime,
};
export default publicAPI;


// ***********************

function listLocalIdentities() {
	return Object.keys(localIdentities);
}

function getCachedCryptoKey(localID) {
	if (
		// cryptographic key currently in cache?
		(localID in cryptoKeyCache) &&

		// ... and not expired yet?
		cryptoKeyCache[localID].timestamp >= (
			Date.now() - MAX_CRYPTO_KEY_CACHE_LIFETIME
		)
	) {
		let { timestamp, ...cryptoKey } = cryptoKeyCache[localID];
		return cryptoKey;
	}
}

function cacheCryptoKey(localID,cryptoKey,forceUpdate = false) {
	if (!(localID in cryptoKeyCache) || forceUpdate) {
		cryptoKeyCache[localID] = {
			...cryptoKey,
			timestamp: Date.now(),
		};
	}
}

function clearCryptoKeyCache(localID) {
	if (localID != null) {
		delete cryptoKeyCache[localID]
	}
	else {
		cryptoKeyCache = {};
	}
}

function removeLocalAccount(localID) {
	delete cryptoKeyCache[localID];
	delete localIdentities[localID];
	storeLocalIdentities();
}

async function getCryptoKey(
	{
		localIdentity: localID = toBase64String(generateEntropy(15)),
		username = "local-user",
		displayName = "Local User",
		relyingPartyID = document.location.hostname,
		relyingPartyName = "Local Data Lock",

		addNewPasskey = false,
		resetCryptoKey = false,
		verify = true,
	} = {},
) {
	// local-identity already registered?
	var identityRecord = localIdentities[localID];
	if (identityRecord != null) {
		// cryptographic key already in cache?
		let cryptoKey = getCachedCryptoKey(localID);
		if (cryptoKey != null && !resetCryptoKey) {
			if (addNewPasskey) {
				resetAbortToken();

				let { record, } = await registerLocalIdentity(cryptoKey);
				identityRecord.lastSeq = record.lastSeq;
				identityRecord.passkeys = [
					...identityRecord.passkeys,
					...record.passkeys
				];
				storeLocalIdentities();
			}

			// return cached cryptographic key info
			return {
				...cryptoKey,
				localIdentity: localID,
			};
		}
		else {
			// remove expired cache entry (if any)
			delete cryptoKeyCache[localID];

			// create new cryptographic key (and passkey)?
			if (resetCryptoKey) {
				resetAbortToken();

				// throw away previous identity record (including
				// previous passkeys) and replace with this new
				// identity record and passkey
				({
					record: localIdentities[localID],
					cryptoKey,
				} = await registerLocalIdentity());
				storeLocalIdentities();

				return {
					...cryptoKey,
					localIdentity: localID,
				};
			}
			// auth with existing passkey (and cache resulting crypto key)?
			else if (!addNewPasskey) {
				resetAbortToken();

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
					...extractCryptoKey(authResult),
					localIdentity: localID,
				};
			}
			else {
				throw new Error("Encryption/Decryption key not currently cached, unavailable for new passkey");
			}
		}
	}
	// attempt auth (with existing discoverable passkey) to extract
	// (and cache!) existing crypto key?
	else if (!addNewPasskey) {
		resetAbortToken();
		let authOptions = authDefaults({
			relyingPartyID,
			mediation: "optional",
			signal: abortToken.signal,
		});
		let authResult = await auth(authOptions);
		let cryptoKey = extractCryptoKey(authResult);

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
			delete cryptoKeyCache[localID];
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

			cacheCryptoKey(localID,cryptoKey);
		}
		else if (verify) {
			throw new Error("Auth verification requested but skipped, against unrecognized passkey (no matching local-identity)");
		}

		return {
			...cryptoKey,
			localIdentity: localID,
		};
	}
	// new local-identity needs initial registration
	else {
		resetAbortToken();
		let { record, cryptoKey, } = await registerLocalIdentity();
		localIdentities[localID] = record;
		cacheCryptoKey(localID,cryptoKey);
		storeLocalIdentities();
		return {
			...cryptoKey,
			localIdentity: localID,
		};
	}


	// ***********************

	async function registerLocalIdentity(cryptoKey = deriveCryptoKey()) {
		try {
			let identityRecord = localIdentities[localID];
			let lastSeq = ((identityRecord || {}).lastSeq || 0) + 1;

			// note: encode the userHandle field of the passkey with the
			// first 32 bytes of the keypair IV, and then 2 bytes
			// to encode (big-endian) a passkey sequence value; this
			// additional value allows multiple passkeys (up to 65,535 of
			// them) registered on the same authenticator, sharing the same
			// cryptographic keypair IV in its userHandle
			let userHandle = new Uint8Array(cryptoKey.iv.byteLength + 2);
			let seqBytes = new DataView(new ArrayBuffer(2));
			seqBytes.setInt16(0,lastSeq,/*littleEndian=*/false);
			userHandle.set(cryptoKey.iv,0);
			userHandle.set(new Uint8Array(seqBytes.buffer),cryptoKey.iv.byteLength);

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
				cryptoKey,
			};
		}
		catch (err) {
			console.log(err);
			throw new Error("Identity/Passkey registration failed",{ cause: err, });
		}
	}

	function extractCryptoKey(authResult) {
		try {
			if (
				authResult &&
				authResult.response &&
				isByteArray(authResult.response.userID) &&
				authResult.response.userID.byteLength == (IV_BYTE_LENGTH + 2)
			) {
				let cryptoKey = deriveCryptoKey(
					authResult.response.userID.subarray(0,IV_BYTE_LENGTH)
				);
				cacheCryptoKey(localID,cryptoKey);
				return cryptoKey;
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

function resetAbortToken() {
	// previous attempt still pending?
	if (abortToken) {
		abortToken.abort("Passkey operation abandoned.");
	}
	abortToken = new AbortController();
}

function generateEntropy(numBytes = 16) {
	return sodium.randombytes_buf(numBytes);
}

function deriveCryptoKey(iv = generateEntropy(IV_BYTE_LENGTH)) {
	try {
		let ed25519KeyPair = sodium.crypto_sign_seed_keypair(iv);
		return {
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

function lockData(
	data,
	cryptoKey,
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
		let encData = sodium.crypto_box_seal(dataBuffer,cryptoKey.encPK);
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
	cryptoKey,
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
			cryptoKey.encPK,
			cryptoKey.encSK
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

function loadLocalIdentities() {
	return (
		Object.fromEntries(
			Object.entries(
				JSON.parse(
					window.localStorage.getItem("local-identities") || null
				) || {}
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

function storeLocalIdentities() {
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
		window.localStorage.setItem("local-identities",JSON.stringify(identities));
	}
	else {
		window.localStorage.removeItem("local-identities");
	}
}

function setMaxCryptoKeyCacheLifetime(
	ms = 30 * 60 * 1000			// 30 min (default)
) {
	return (MAX_CRYPTO_KEY_CACHE_LIFETIME = Math.max(0,Number(ms) || 0));
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
