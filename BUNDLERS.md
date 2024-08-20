# Deploying Local-Data-Lock WITH A Bundler

This project has non-ESM dependencies, which unfortunately cannot be *bundled* in with your other app code. Modern bundlers unfortunately don't out-of-the-box support configurations that can handle such a situation.

As such, this project provides plugins for Astro, Vite, and Webpack, to take care of the various steps needed to get these non-ESM dependencies into an otherwise bundled web app built by those tools.

## Bundler Plugins

The plugins for Astro, Vite, and Webpack are included in the `bundler-plugins/` directory. They should handle all necessary steps to load the dependencies.

**Note:** You should not need to manually copy any files, as the plugins access the dependencies (in `node_modules`) directly to pull the files needed. But for reference, the files these plugins access are:

* `node_modules/@lo-fi/local-data-lock/dist/bundlers/ldl.mjs`

    ESM library module that's suitable for bundling and `import`ing into your web app.

    **Note:** this is *not* the same as `node_modules/@lo-fi/local-data-lock/dist/auto/ldl.js`, which is only intended [for web application projects WITHOUT a bundler](NON-BUNDLERS.md)

* `node_modules/@lo-fi/webauthn-local-client/dist/bundlers/walc.mjs`

* `node_modules/@lo-fi/webauthn-local-client/dist/bundlers/walc-external-bundle.js`

    Non-ESM (plain global .js) bundle of dependencies that must be loaded separately from (and prior to) your app's bundle.

### Astro Plugin (aka Integration)

If using Astro 4+, it's strongly suggested to import this library's Astro-plugin to manage the loading of its non-ESM dependencies. Add something like the following to your `astro.config.mjs` file:

```js
import { defineConfig } from "astro/config";

import LDL from "@lo-fi/local-data-lock/bundlers/astro";

export default defineConfig({
    // ..

    integrations: [ LDL(), ],

    vite: {
        plugins: [
            // pulls in some necessary bits of LDL's vite plugin
            LDL.vite(),
        ],

        optimizeDeps: {
            esbuildOptions: {
                // LDL's WALC dependency uses "top-level await", which is ES2022+
                target: "es2022",
            },
        },

        build: {
            // LDL's WALC dependency uses "top-level await", which is ES2022+
            target: "es2022"
        },
    },

    // ..
});
```

This plugin works for the `astro dev` (dev-server), as well as `astro build` / `astro preview` modes. In all cases, it copies the WebAuthn-Local-Client (`@lo-fi/webauthn-local-client`) dependency bundle file (`/dist/bundlers/walc-external-bundle.js`) into the `public/` directory of your project root, as well as the `dist/` directory when running a build. It also injects an inline `<script>` element into the `<head>` of all generated pages, which dynamically loads the `/walc-external-bundle.js` script file (which has all the dependencies WALC needs).

**Note:** At present, this plugin is not configurable in any way (i.e., calling `LDL()` above with no arguments). If something about its behavior is not compatible with your Astro project setup -- which can vary widely and be quite complex to predict or support by a basic plugin -- it's recommended you simply copy over the `local-data-lock/bundler-plugins/astro.mjs` plugin and make necessary changes.

### Vite Plugin

If using Vite 5+ directly, it's strongly suggested to import this library's Vite-plugin to manage the loading of its non-ESM dependencies. Add something like the following to your `vite.config.js` file:

```js
import { defineConfig } from "vite";
import LDL from "@lo-fi/local-data-lock/bundlers/vite";

export default defineConfig({
    // ..

    plugins: [ LDL() ],

    optimizeDeps: {
        esbuildOptions: {
            // WALC (dependency) uses "top-level await", which is ES2022+
            target: "es2022",
        },
    },

    build: {
        // WALC (dependency) uses "top-level await", which is ES2022+
        target: "es2022"
    },

    // ..
});
```

This plugin works for the `vite dev` (dev-server), `vite preview` (also dev-server), and `vite build` modes. In all cases, it copies the `node_modules/@lo-fi/webauthn-local-client/dist/bundlers/walc-external-bundle.js` file into the `public/` directory of your project root. It also injects a `<script src="/walc-external-bundle.js"></script>` tag into the markup of the `index.html` file that Vite produces for your app.

**Note:** At present, this plugin is not configurable in any way (i.e., calling `LDL()` above with no arguments). If something about its behavior is not compatible with your Vite project setup -- which can vary widely and be quite complex to predict or support by a basic plugin -- it's recommended you simply copy over the `node_modules/@lo-fi/local-data-lock/bundler-plugins/vite.mjs` plugin and make necessary changes.

#### Top-level `await`

This library's main dependency (**WebAuthn-Local-Client**) uses ["top-level `await`"](https://github.com/tc39/proposal-top-level-await), a feature added to JS in ES2022. The current default target for Vite seems to be browsers older than this, so the above config explicitly sets the *targets* to `"es2022"`.

You may experience issues where your tooling/configuration either ignores this setting, or otherwise breaks with it set. This may variously result in seeing an error about the top-level `await`s in this library being incompatible with the built-target, or an error about `await` needing to only be in `async function`s or the top-level of a module (which it is!).

You may need to configure Vite to skip trying to optimize the `walc.mjs` file during bundling, something like:

```js
export default defineConfig({

    // ..

    optimizeDeps: {
        exclude: [ "@lo-fi/webauthn-local-client" ]
    }

    // ..
});
```

#### SSR Breakage

An unfortunate gotcha of some tools that wrap Vite (e.g., Nuxt, etc) and do SSR (server-side rendering) is that they *break* a key assumption/behavior of this module's Vite plugin: the HTML injection of `<script src="/walc-external-bundle.js"></script>`.

As such, you'll likely need to manually add that `<script>` tag to your HTML pages/templates. The Vite plugin still copies that file into the `public/` folder for you, so it should load once the tag is added to your HTML.

### Webpack Plugin

If using Webpack 5+, make sure you're already using the [HTML Webpack Plugin](https://github.com/jantimon/html-webpack-plugin/) to manage building your `index.html` (and/or other HTML pages).

Then import this library's Webpack-plugin to manage the loading of its non-ESM dependencies. Add something like the following to your `webpack.config.js`:

```js
// 'HtmlWebpackPlugin' is a required dependency of the
// local-data-lock Webpack plugin
import HtmlWebpackPlugin from "html-webpack-plugin";
import LDL from "@lo-fi/local-data-lock/bundlers/webpack";

export default {
    // ..

    plugins: [
        // required LDL dependency
        new HtmlWebpackPlugin({
            // ..
        }),

        LDL()
    ],

    // ..
};
```

This plugin copies the `node_modules/@lo-fi/webauthn-local-client/dist/bundlers/walc-external-bundle.js` file into the build root (default `dist/`), along with the other bundled files. It also injects a `<script src="walc-external-bundle.js"></script>` tag into the markup of the `index.html` file (and any other HTML files) that Webpack produces for your app.

**Note:** At present, this plugin is not configurable in any way (i.e., calling `LDL()` above with no arguments). If something about its behavior is not compatible with your Webpack project setup -- which can vary widely and be quite complex to predict or support by a basic plugin -- it's recommended you simply copy over the `local-data-lock/bundler-plugins/webpack.mjs` plugin and make necessary changes.

## Import/Usage

To import and use **local-data-lock** in a *bundled* browser app:

```js
import { getLockKey, lockData, unlockData } from "@lo-fi/local-data-lock";
```

When `import`ed like this, Astro, Vite, Webpack should (via these plugins) properly find and bundle the `dist/bundlers/ldl.mjs` ESM library module with the rest of your app code, hopefully without any further steps necessary.
