import path from "node:path";

import vitePlugin from "./vite.mjs";
import walcAstroPlugin from "@lo-fi/webauthn-local-client/bundlers/astro";


// ********************************

export default LDL;


// ********************************

function LDL() {
	var walcAstro = walcAstroPlugin();
	var vite = vitePlugin();

	LDL.vite = () => {
		// copy a subset of the vite plugin hooks that are still
		// necessary, even though astro plugin is mostly taking
		// over the task
		return {
			name: vite.name,
			enforce: vite.enforce,
			resolveId: vite.resolveId,
			load: vite.load,
		};
	};

	return {
		...walcAstro,
		name: "astro-plugin-ldl",
	};
}
