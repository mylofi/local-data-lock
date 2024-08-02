# Local Data Secure

[![npm Module](https://badge.fury.io/js/@lo-fi%2Flocal-data-secure.svg)](https://www.npmjs.org/package/@lo-fi/local-data-secure)
[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

**Local Data Secure** provides a simple utility interface for encrypting and decrypting local-first application data using a keypair stored and protected by [Webauthn](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API) (biometric passkeys).

----

[Library Tests (Demo)](https://mylofi.github.io/local-data-secure/)

----

The intent of this library is to store encrypted data on the device, and protect the encryption/decryption keypair securely in a passkey that the user can access by presenting their biometric factor(s). Further, the cryptographic keypair may also be used for secured asymmetric data transmission.

The primary dependency of this library is [**WebAuthn-Local-Client**](https://github.com/mylofi/webauthn-local-client), which wraps the [WebAuthn API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API) for managing passkeys entirely in the local client (zero servers).

**Local-Data-Secure** generates an encryption/decryption keypair, storing that securely in the passkey (via its `userHandle` field), which is protected by a device's secure enclave/keychain/etc. The library also stores entries for these passkeys in the device's [`LocalStorage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) -- specifically, the public-key info for the passkey itself, which is necessary for **verifying** subsequent passkey authentication responses.

**NOTE:** This public-key for a passkey is *NOT* in any way related to the encryption/decryption keypair, which **Local-Data-Secure** does not persist anywhere on the device (only kept in memory). It's *only* used for authentication verification (protecting against MitM attacks on the device biometric system). Verification defaults to on, but can be skipped by passing `verify: false` as an option to the `getCryptoKey()` method.

Your application accesses the encryption/decryption keypair via `getCryptoKey()`, and may optionally decide if you want to persist it somewhere -- for more convenience/ease-of-use, as compared to asking the user to re-authenticate their passkey on each usage. But you are cautioned to be very careful in such decisions, striking an appropriate balance between security and convenience.

To assist in making these difficult tradeoffs, **Local-Data-Secure** internally caches the encryption/decryption key after a successful passkey authentication, and keeps it in memory (assuming no page refresh) for a period of time (by default, 30 minutes); a user won't need to re-authenticate their passkey more often than once per 30 minutes. This default time threshold can also be adjusted from 0ms or higher, using the `setMaxCryptoKeyCacheLifetime()` method.

You are strongly encouraged **NOT** to persist the encryption/decryption key, and to utilize this time-based caching mechanism.

## Deployment / Import

```cmd
npm install @lo-fi/local-data-secure
```

The [**@lo-fi/local-data-secure** npm package](https://npmjs.com/package/@lo-fi/local-data-secure) includes a `dist/` directory with all files you need to deploy **Local Data Secure** (and its dependencies) into your application/project.

**Note:** If you obtain this library via git instead of npm, you'll need to [build `dist/` manually](#re-building-dist) before deployment.

* **USING A WEB BUNDLER?** (Vite, Webpack, etc) Use the `dist/bundlers/*` files and see [Bundler Deployment](BUNDLERS.md) for instructions.

* Otherwise, use the `dist/auto/*` files and see [Non-Bundler Deployment](NON-BUNDLERS.md) for instructions.

## `WebAuthn` Supported?

To check if `WebAuthn` API and functionality is supported on the device, the **WebAuthn-Local-Client** dependency provides the `supportsWebAuthn` exported boolean:

```js
import { supportsWebAuthn } from "@lo-fi/webauthn-local-client";

if (supportsWebAuthn) {
    // welcome to the future, without passwords!
}
else {
    // sigh, use fallback authentication, like
    // icky passwords :(
}
```

## Registering a local account

A "local account" is merely a collection of one or more passkeys that are all holding the same encryption/decryption keypair. There's no limit on the number of "local account" passkey collections on a device (other than device storage limits).

To register a new local account:

```js
import { getCryptoKey } from "...";

var key = await getCryptoKey({ addNewPasskey: true, });
```

The returned keypair result will also include a `localIdentity` property, with a unique ID (`string` value) for the local account. This local account ID should be stored by your application (in local-storage, cookie, etc):

```js
var currentAccountID = key.localIdentity;
```

### Obtaining the keypair from existing account/passkey

If the `currentAccountID` (as shown above) is available, it should be used in subsequent calls to `getCryptoKey()` when re-obtaining the encryption/decryption keypair from the existing passkey:

```js
var key = await getCryptoKey({ localIdentitity: currentAccountID, });
```

If you don't have (or the application loses) an account ID, call `listLocalIdentities()` to receive an array of all registed local account IDs.

Alternatively, `getCryptoKey()` can be called WITHOUT either `localIdentity` or `addNewPasskey` options, in which case the device will prompt the user to select a discoverable passkey (if supported). If the user chooses a passkey that matches one of the registered local accounts, the keypair (and its `localIdentity` account ID property) will be returned.

### Adding alternate passkeys to an account

Users may prefer a more robust security setup (less chance of identity/data loss), by registering more than one passkey (for example, FaceID + TouchID) -- each holds a copy of the encryption/decryption keypair.

To prompt for adding a new passkey to an existing local account:

```js
/*var key =*/ await getCryptoKey({ localIdentitity: currentAccountID, addNewPasskey: true, });
```

### Change passkey cache lifetime

To change the default (30 minutes) lifetime for caching passkey authentication (encryption/decryption keypair):

```js
import { setMaxCryptoKeyCacheLifetime } from "..";

// change default lifetime to 5 minutes
setMaxCryptoKeyCacheLifetime(5 * 60 * 1000);
```

### Clear the passkey/keypair cache

To clear a cache entry (effectively, "logging out"):

```js
import { clearCryptoKeyCache } from "..";

clearCryptoKeyCache(currentAccountID);
```

To clear *all* cache entries, omit the local account ID:

```js
clearCryptoKeyCache();
```

### Removing a local account

To remove a local account (from device local storage), thereby discarding associated passkey public-key info (necessary for verifying passkey authentication responses):

```js
import { removeLocalAccount } from "..";

removeLocalAccount(currentAccountID);
```

## Encrypt some data

Once a keypair has been obtained, to encrypt application data:

```js
import { encryptData } from "...";

var encData = encryptData(someData,key);
```

The `encryptData()` method will auto-detect the type of `someData`, so most any value (even a JSON-compatible object) is suitable to pass in.

**Note:** If `someData` is already an array-buffer or typed-array, no transformation is necessary. If it's an object, a JSON string serialization is attempted. Otherwise, a string coercion is performed on the value. Regardless, the resulting string is then converted to a typed-array representation for encryption.

The default representation in the return value (`encData`) will be a base64 encoded string (suitable for storing in LocalStorage, transmitting in JSON, etc). If you prefer the `Uint8Array` binary representation:

```js
var encDataBuffer = encryptData(someData,{ outputFormat: "raw" });
```

## Decrypt some data

With the keypair and a previously encrypted data value (from `encryptData()`), decryption can be performed:

```js
import { decryptData } from "..";

var data = decryptData(encData,key);
```

The `decryptData()` method will auto-detect the type of `encData` (either the base64 string encoding, or the `Uint8Array` encoding).

By default, the decrypted data is assumed to be a UTF8 JSON serialization string to be parsed. But if you are not encrypting/decrypting JSON-compatible data objects:

```js
var dataStr = decryptData(encData,key,{ parseJSON: false });
```

If you want the raw `Uint8Array` binary representation returned:

```js
var dataBuffer = decryptData(encData,key,{ outputFormat: "raw" });
```

## Deriving an encryption/decryption key

If you want to manually derive the keypair information from a secure random seed value (`Uint8Array` with enough random entropy):

```js
import { deriveCryptoKey } from "..";

var key = deriveCryptoKey(seedValue);
```

This keypair is suitable to use with `encryptData()` and `decryptData()` methods. However, the keypair is NOT associated with (or protected by) a device passkey; it has no entry in the device's local-storage and will never be returned from `getCryptoKey()`. The intent of this library is to rely on passkeys, so you are encouraged *not* to pursue this manual approach unless strictly necessary.

To generate a suitable cryptograhpically random `seedValue`:

```js
import { generateEntropy } from "..";

var seedValue = generateEntropy(32);
```

**Note:** The encryption/decryption keypairs this library uses (via underlying libsodium methods) require specifically 32 bytes (256 bits) of entropy for the seed value.

Returned `seedValue` will be a raw `Uint8Array` binary typed-array.

## Re-building `dist/*`

If you need to rebuild the `dist/*` files for any reason, run:

```cmd
# only needed one time
npm install

npm run build:all
```

## Tests

Since the library involves non-automatable behaviors (requiring user intervention in browser), an automated unit-test suite is not included. Instead, a simple interactive browser test page is provided.

Visit [`https://mylofi.github.io/local-data-secure/`](https://mylofi.github.io/local-data-secure/), and follow instructions in-page from there to perform the interactive tests.

### Run Locally

To locally run the tests, start the simple static server (no server-side logic):

```cmd
# only needed one time
npm install

npm run test:start
```

Then visit `http://localhost:8080/` in a browser.

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2024 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
