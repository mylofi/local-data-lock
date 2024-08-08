#!/usr/bin/env node

"use strict";

var path = require("path");
var fs = require("fs");
var fsp = require("fs/promises");

var micromatch = require("micromatch");
var recursiveReadDir = require("recursive-readdir-sync");
var terser = require("terser");

const PKG_ROOT_DIR = path.join(__dirname,"..");
const SRC_DIR = path.join(PKG_ROOT_DIR,"src");
const MAIN_COPYRIGHT_HEADER = path.join(SRC_DIR,"copyright-header.txt");
const LDL_SRC = path.join(SRC_DIR,"ldl.js");
const NODE_MODULES_DIR = path.join(PKG_ROOT_DIR,"node_modules");
const LOFI_WALC_DIST_DIR = path.join(NODE_MODULES_DIR,"@lo-fi","webauthn-local-client","dist");
const LOFI_WALC_DIST_AUTO_DIR = path.join(LOFI_WALC_DIST_DIR,"auto");
const LOFI_WALC_DIST_BUNDLERS_DIR = path.join(LOFI_WALC_DIST_DIR,"bundlers");

const DIST_DIR = path.join(PKG_ROOT_DIR,"dist");
const DIST_AUTO_DIR = path.join(DIST_DIR,"auto");
const DIST_AUTO_EXTERNAL_DIR = path.join(DIST_AUTO_DIR,"external");
const DIST_AUTO_EXTERNAL_LOFI_DIR = path.join(DIST_AUTO_EXTERNAL_DIR,"@lo-fi");
const DIST_AUTO_EXTERNAL_LOFI_WALC_DIR = path.join(DIST_AUTO_EXTERNAL_LOFI_DIR,"webauthn-local-client");
const DIST_BUNDLERS_DIR = path.join(DIST_DIR,"bundlers");


main().catch(console.error);


// **********************

async function main() {
	console.log("*** Building JS ***");

	// try to make various dist/ directories, if needed
	for (let dir of [
			DIST_DIR,
			DIST_AUTO_DIR,
			DIST_AUTO_EXTERNAL_DIR,
			DIST_AUTO_EXTERNAL_LOFI_DIR,
			DIST_AUTO_EXTERNAL_LOFI_WALC_DIR,
			DIST_BUNDLERS_DIR,
		]) {
		if (!(await safeMkdir(dir))) {
			throw new Error(`Target directory (${dir}) does not exist and could not be created.`);
		}
	}

	// read package.json
	var packageJSON = require(path.join(PKG_ROOT_DIR,"package.json"));
	// read version number from package.json
	var version = packageJSON.version;
	// read main src copyright-header text
	var mainCopyrightHeader = await fsp.readFile(MAIN_COPYRIGHT_HEADER,{ encoding: "utf8", });
	// render main copyright header with version and year
	mainCopyrightHeader = (
		mainCopyrightHeader
			.replace(/#VERSION#/g,version)
			.replace(/#YEAR#/g,(new Date()).getFullYear())
	);

	// build src/* files in dist/auto/
	await buildFiles(
		recursiveReadDir(SRC_DIR),
		SRC_DIR,
		DIST_AUTO_DIR,
		prepareFileContents,
		/*skipPatterns=*/[ "**/*.txt", "**/*.json", "**/external" ]
	);

	// build src/ldl.js to bundlers/ldl.mjs
	await buildFiles(
		[ LDL_SRC, ],
		SRC_DIR,
		DIST_BUNDLERS_DIR,
		(contents,outputPath,filename = path.basename(outputPath)) => prepareFileContents(
			contents,
			outputPath.replace(/\.js$/,".mjs"),
			`bundlers/${filename.replace(/\.js$/,".mjs")}`
		),
		/*skipPatterns=*/[ "**/*.txt", "**/*.json", "**/external" ]
	);

	// build dist/auto/external/*
	await buildFiles(
		recursiveReadDir(LOFI_WALC_DIST_AUTO_DIR),
		LOFI_WALC_DIST_AUTO_DIR,
		DIST_AUTO_EXTERNAL_LOFI_WALC_DIR,
		// simple copy as-is
		(contents,outputPath) => ({ contents, outputPath, })
	);

	console.log("Complete.");


	// ****************************

	async function prepareFileContents(contents,outputPath,filename = path.basename(outputPath)) {
		// JS file (to minify)?
		if (/\.[mc]?js$/i.test(filename)) {
			contents = await minifyJS(contents);
		}

		// add copyright header
		return {
			contents: `${
				mainCopyrightHeader.replace(/#FILENAME#/g,filename)
			}\n${
				contents
			}`,

			outputPath,
		};
	}
}

async function buildFiles(files,fromBasePath,toDir,processFileContents,skipPatterns) {
	for (let fromPath of files) {
		// should we skip copying this file?
		if (matchesSkipPattern(fromPath,skipPatterns)) {
			continue;
		}
		let relativePath = fromPath.slice(fromBasePath.length);
		let outputPath = path.join(toDir,relativePath);
		let contents = await fsp.readFile(fromPath,{ encoding: "utf8", });
		({ contents, outputPath, } = await processFileContents(contents,outputPath));
		let outputDir = path.dirname(outputPath);

		if (!(fs.existsSync(outputDir))) {
			if (!(await safeMkdir(outputDir))) {
				throw new Error(`While copying files, directory (${outputDir}) could not be created.`);
			}
		}

		await fsp.writeFile(outputPath,contents,{ encoding: "utf8", });
	}
}

async function minifyJS(contents,esModuleFormat = true) {
	let result = await terser.minify(contents,{
		mangle: {
			keep_fnames: true,
		},
		compress: {
			keep_fnames: true,
		},
		output: {
			comments: /^!/,
		},
		module: esModuleFormat,
	});
	if (!(result && result.code)) {
		if (result.error) throw result.error;
		else throw result;
	}
	return result.code;
}

function matchesSkipPattern(pathStr,skipPatterns) {
	if (skipPatterns && skipPatterns.length > 0) {
		return (micromatch(pathStr,skipPatterns).length > 0);
	}
}

async function safeMkdir(pathStr) {
	if (!fs.existsSync(pathStr)) {
		try {
			await fsp.mkdir(pathStr,0o755);
			return true;
		}
		catch (err) {}
		return false;
	}
	return true;
}
