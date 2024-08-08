import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";

import WALC from "@lo-fi/webauthn-local-client/bundlers/vite";


// ********************************

export default LDL;


// ********************************

function LDL() {
	var ldlSrcPath;

	var depPlugin = WALC();

	return {
		...depPlugin,

		name: "vite-plugin-ldl",

		async configResolved(cfg) {
			var bundlersDir = path.join(cfg.root,"node_modules","@lo-fi","local-data-lock","dist","bundlers");
			ldlSrcPath = path.join(bundlersDir,"ldl.mjs");

			return depPlugin.configResolved(cfg);
		},

		load(id,opts) {
			if (id == "@lo-fi/local-data-lock") {
				return fs.readFileSync(ldlSrcPath,{ encoding: "utf8", });
			}
			return depPlugin.load(id,opts);
		},
	};
}
