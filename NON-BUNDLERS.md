# Deploying Local-Data-Lock WITHOUT A Bundler

To use this library directly -- i.e., in a classic/vanilla web project without a modern bundler tool -- make a directory for it (e.g., `local-data-lock/`) in your browser app's JS assets directory.

Then copy over all `dist/auto/*` contents, as-is:

* `dist/auto/ldl.js`

    **Note:** this is *not* the same as `dist/bundlers/ldl.mjs`, which is only intended [for web application projects WITH a bundler](BUNDLERS.md)

* `dist/auto/external/*` (preserve the whole `external/` sub-directory):
    - `@lo-fi/webauthn-local-client/walc.js`
    - `@lo-fi/webauthn-local-client/external.js`
    - `@lo-fi/webauthn-local-client/external/asn1.all.min.js`
    - `@lo-fi/webauthn-local-client/external/cbor.js`
    - `@lo-fi/webauthn-local-client/external/libsodium.js`
    - `@lo-fi/webauthn-local-client/external/libsodium-wrappers.js`

## Import/Usage

To import and use **local-data-lock** in a *non-bundled* browser app:

```js
import { getLockKey, lockData, unlockData } from "/path/to/js-assets/local-data-lock/ldl.js";
```

The library's dependencies will be auto-loaded (via `external.js`).

## Using Import Map

If your **non-bundled** browser app has an [Import Map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap), you can improve the `import` by adding an entry for this library:

```html
<script type="importmap">
{
    "imports": {
        "local-data-lock": "/path/to/js-assets/local-data-lock/ldl.js",

        "@lo-fi/webauthn-local-client": "/path/to/js-assets/local-data-lock/external/@lo-fi/webauthn-local-client/walc.js"
    }
}
</script>
```

Now, you'll be able to `import` the library in your app in a friendly/readable way:

```js
import { getLockKey, lockData, unlockData } from "local-data-lock";
```

**Note:** If you omit the above `"local-data-lock"` import-map entry, you can still `import` **local-data-lock** by specifying the proper path to `ldl.js`. However, the entry above for `"@lo-fi/webauthn-local-client"` is more required. Alternatively, you'll have to manually edit the `ldl.js` file to change its `import` specifier from `"@lo-fi/webauthn-local-client"` to the proper path to `walc.js`.
