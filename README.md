# Local Data Lock

[![npm Module](https://badge.fury.io/js/@lo-fi%2Flocal-data-lock.svg)](https://www.npmjs.org/package/@lo-fi/local-data-lock)
[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

**Local Data Lock** provides a simple utility interface for encrypting and decrypting local-first application data using a keypair stored and protected by [Webauthn](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API) (biometric passkeys).

----

[Library Tests (Demo)](https://mylofi.github.io/local-data-lock/)

----

The intent of this library is to store encrypted data on the device, and protect the encryption/decryption keypair securely in a passkey that the user can access by presenting their biometric factor(s). Further, the cryptographic keypair may also be used for secured asymmetric data transmission.

The primary dependency of this library is [**WebAuthn-Local-Client**](https://github.com/mylofi/webauthn-local-client), which wraps the [WebAuthn API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API) for managing passkeys entirely in the local client (zero servers).

**Local Data Lock** generates an encryption/decryption keypair, storing that securely in the passkey (via its `userHandle` field), which is protected by the authenticator/device. The library also stores entries for these passkeys in the device's [`LocalStorage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) -- specifically, the public-key info for the passkey itself, which is necessary for **verifying** subsequent passkey authentication responses.

**NOTE:** This public-key for a passkey is *NOT* in any way related to the encryption/decryption keypair, which **Local Data Lock** does not persist anywhere on the device (only kept in memory). It's *only* used for authentication verification (protecting against MitM attacks on the device biometric system). Verification defaults to on, but can be skipped by passing `verify: false` as an option to the `getLockKey()` method.

Your application accesses the encryption/decryption keypair via `getLockKey()`, and may optionally decide if you want to persist it somewhere -- for more convenience/ease-of-use, as compared to asking the user to re-authenticate their passkey on each usage. But you are cautioned to be very careful in such decisions, striking an appropriate balance between security and convenience.

To assist in making these difficult tradeoffs, **Local Data Lock** internally caches the encryption/decryption key after a successful passkey authentication, and keeps it in memory (assuming no page refresh) for a period of time (by default, 30 minutes); a user won't need to re-authenticate their passkey more often than once per 30 minutes. This default time threshold can also be adjusted from 0ms or higher, using the `setMaxLockKeyCacheLifetime()` method.

You are strongly encouraged **NOT** to persist the encryption/decryption key, and to utilize this time-based caching mechanism.

## Deployment / Import

```cmd
npm install @lo-fi/local-data-lock
```

The [**@lo-fi/local-data-lock** npm package](https://npmjs.com/package/@lo-fi/local-data-lock) includes a `dist/` directory with all files you need to deploy **Local Data Lock** (and its dependencies) into your application/project.

**Note:** If you obtain this library via git instead of npm, you'll need to [build `dist/` manually](#re-building-dist) before deployment.

* **USING A WEB BUNDLER?** (Astro, Vite, Webpack, etc) Use the `dist/bundlers/*` files and see [Bundler Deployment](BUNDLERS.md) for instructions.

* Otherwise, use the `dist/auto/*` files and see [Non-Bundler Deployment](NON-BUNDLERS.md) for instructions.

## `WebAuthn` Supported?

To check if `WebAuthn` API and functionality is supported on the device, consult the `supportsWebAuthn` exported boolean:

```js
import { supportsWebAuthn } from "..";

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
import { getLockKey } from "..";

var key = await getLockKey({ addNewPasskey: true, });
```

The returned keypair result will also include a `localIdentity` property, with a unique ID (`string` value) for the local account. This local account ID should be stored by your application (in local-storage, cookie, etc):

```js
var currentAccountID = key.localIdentity;
```

### Obtaining the keypair from existing account/passkey

If the `currentAccountID` (as shown above) is available, it should be used in subsequent calls to `getLockKey()` when re-obtaining the encryption/decryption keypair from the existing passkey:

```js
var key = await getLockKey({ localIdentitity: currentAccountID, });
```

If you don't have (or the application loses) an account ID, call `listLocalIdentities()` to receive an array of all registed local account IDs.

Alternatively, `getLockKey()` can be called WITHOUT either `localIdentity` or `addNewPasskey` options, in which case the device will prompt the user to select a discoverable passkey (if supported). If the user chooses a passkey that matches one of the registered local accounts, the keypair (and its `localIdentity` account ID property) will be returned.

### Adding alternate passkeys to an account

Users may prefer a more robust security setup (less chance of identity/data loss), by registering more than one passkey (for example, FaceID + TouchID) -- each holds a copy of the encryption/decryption keypair.

To prompt for adding a new passkey to an existing local account:

```js
/*var key =*/ await getLockKey({ localIdentitity: currentAccountID, addNewPasskey: true, });
```

### Change passkey cache lifetime

To change the default (30 minutes) lifetime for caching passkey authentication (encryption/decryption keypair):

```js
import { setMaxLockKeyCacheLifetime } from "..";

// change default lifetime to 5 minutes
setMaxLockKeyCacheLifetime(5 * 60 * 1000);
```

### Clear the passkey/keypair cache

To clear a cache entry (effectively, "logging out"):

```js
import { clearLockKeyCache } from "..";

clearLockKeyCache(currentAccountID);
```

To clear *all* cache entries, omit the local account ID:

```js
clearLockKeyCache();
```

### Removing a local account

To remove a local account (from device local storage), thereby discarding associated passkey public-key info (necessary for verifying passkey authentication responses):

```js
import { removeLocalAccount } from "..";

removeLocalAccount(currentAccountID);
```

### Configuring Passkeys

There are several options available to the `getLockKey()` method, to customize the information used when registering passkeys:

```js
var key = await getLockKey({
    addNewPasskey: true,  // or "localIdentity: .." + "resetLockKey: true"

    /* passkey configuration options: */
    username: "a-local-username",
    displayName: "A Local Username",
    relyingPartyID: "myappdomain.tld",
    relyingPartyName: "My App",
});
```

All of these passkey configuration options are string values, passed along to the `WebAuthn` API subsystem; they affect how the device saves the passkey once registered, and further verifies its usage later.

The `username` (default: `"local-user"`) and `displayName` (default: `"Local User"`) options are information the system uses in its modal dialogs to indicate to the user which passkey they are using in authentication operations; this library only preserves them for non-functional, metadata/debugging purposes. Ideally, your application should prompt the user for these values before initial passkey registration, or auto-generate values that will make sense to the user.

**Note:** The values don't strictly need to be unique, but if a user registers multiple passkeys with the same username/display-name, it may be confusing to them in future authentications.

The `relyingPartyID` should be the canonical hostname of the web application, or matching an application's package ID (e.g., `com.app.my-favorite`) if it's an app-store installable application. Likewise, `relyingPartyName` (`My Favorite App`) should be a human-friendly name for your application that users will recognize; some devices will display this value in the passkey modal dialogs along with the `username` / `displayName` values.

Three of the options (`username`, `displayName`, and `relyingPartName`) are *only* valid when creating a new passkey, in either `addNewPasskey: true` or `resetLockKey: true` modes; the `relyingPartyID` option can/should be used in all `getLockKey()` calls.

## Encrypt some data

Once a keypair has been obtained, to encrypt application data:

```js
import { lockData } from "..";

var encData = lockData(someData,key);
```

The `lockData()` method will auto-detect the type of `someData`, so most any value (even a JSON-compatible object) is suitable to pass in.

**Note:** If `someData` is already an array-buffer or typed-array, no transformation is necessary. If it's an object, a JSON string serialization is attempted. Otherwise, a string coercion is performed on the value. Regardless, the resulting string is then converted to a typed-array representation for encryption.

The default representation in the return value (`encData`) will be a base64 encoded string (suitable for storing in LocalStorage, transmitting in JSON, etc). If you prefer the `Uint8Array` binary representation:

```js
var encDataBuffer = lockData(
    someData,
    key,
    { outputFormat: "raw" }     // instead of "base64"
);
```

## Decrypt some data

With the keypair and a previously encrypted data value (from `lockData()`), decryption can be performed:

```js
import { unlockData } from "..";

var data = unlockData(encData,key);
```

The `unlockData()` method will auto-detect the type of `encData` (either the base64 string encoding, or the `Uint8Array` binary encoding).

By default, the decrypted data is assumed to be a utf-8 encoded string, with a JSON serialized value to be parsed. But if you are not encrypting/decrypting JSON-compatible data objects, set the `parseJSON: false` option:

```js
var dataStr = unlockData(
    encData,
    key,
    { parseJSON: false }
);
```

If you want the raw `Uint8Array` binary representation returned, instead of the utf-8 string:

```js
var dataBuffer = unlockData(
    encData,
    key,
    { outputFormat: "raw" }     // instead of "utf8" (or "utf-8")
);
```

## Deriving an encryption/decryption key

If you want to manually derive the keypair information from a secure random seed value (`Uint8Array` with enough random entropy):

```js
import { deriveLockKey } from "..";

var key = deriveLockKey(seedValue);
```

This keypair is suitable to use with `lockData()` and `unlockData()` methods. However, the keypair returned WILL NOT be associated with (or protected by) a device passkey; it receives no entry in the device's local-storage and will never be returned from `getLockKey()`. The intent of this library is to rely on passkeys, so you are encouraged *not* to pursue this manual approach unless strictly necessary.

Further, to generate a suitable cryptograhpically random `seedValue`:

```js
import { generateEntropy } from "..";

var seedValue = generateEntropy(32);
```

**Note:** The encryption/decryption keypairs this library uses (via underlying libsodium methods) require specifically 32 bytes (256 bits) of entropy for the seed value.

The returned `seedValue` will be a raw `Uint8Array` binary typed-array.

## WebAuthn-Local-Client Utilities

The following utilities are re-exported from the [`WebAuthn-Local-Client` dependency](https://github.com/mylofi/webauthn-local-client):

* `toBase64String()` - from `Uint8Array` to string in base64 encoding
* `fromBase64String()` - from base64 encoded string to `Uint8Array`
* `toUTF8String()` - from `Uint8Array` to string in utf-8 string
* `fromUTF8String()` - from utf-8 string to `Uint8Array`
* `packPublicKeyJSON()` / `unpackPublicKeyJSON()` -- these are specifically for a passkey entry's `publicKey` property, when being stored/retrieved from `localStroage`

These utilities are helpful when dealing with converting values between various representations, especially for storing values (i.e., `localStorage`, etc).

## Re-building `dist/*`

If you need to rebuild the `dist/*` files for any reason, run:

```cmd
# only needed one time
npm install

npm run build:all
```

## Tests

Since the library involves non-automatable behaviors (requiring user intervention in browser), an automated unit-test suite is not included. Instead, a simple interactive browser test page is provided.

Visit [`https://mylofi.github.io/local-data-lock/`](https://mylofi.github.io/local-data-lock/), and follow instructions in-page from there to perform the interactive tests.

### Run Locally

To instead run the tests locally, first make sure you've [already run the build](#re-building-dist), then:

```cmd
npm test
```

This will start a static file webserver (no server logic), serving the interactive test page from `http://localhost:8080/`; visit this page in your browser to perform tests.

By default, the `test/test.js` file imports the code from the `src/*` directly. However, to test against the `dist/auto/*` files (as included in the npm package), you can modify `test/test.js`, updating the `/src` in its `import` statement to `/dist` (see the import-map in `test/index.html` for more details).

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2024 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
