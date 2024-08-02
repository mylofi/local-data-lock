import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";

import WALC from "@lo-fi/webauthn-local-client/bundlers/vite";


// ********************************

export default LDS;


// ********************************

function LDS() {
	var ldsSrcPath;

	var depPlugin = WALC();

	return {
		...depPlugin,

		name: "vite-plugin-lds",

		async configResolved(cfg) {
			var bundlersDir = path.join(cfg.root,"node_modules","@lo-fi","local-data-secure","dist","bundlers");
			ldsSrcPath = path.join(bundlersDir,"lds.mjs");

			return depPlugin.configResolved(cfg);
		},

		load(id,opts) {
			if (id == "@lo-fi/local-data-secure") {
				return fs.readFileSync(ldsSrcPath,{ encoding: "utf8", });
			}
			return depPlugin.load(id,opts);
		},
	};
}
