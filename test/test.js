import {
	listLocalIdentities,
	clearLockKeyCache,
	removeLocalAccount,
	getLockKey,
	lockData,
	unlockData,
	setMaxLockKeyCacheLifetime,
	resetAbortReason,
	configureStorage,
}
// note: this module specifier comes from the import-map
//    in index.html; swap "src" for "dist" here to test
//    against the dist/* files
from "local-data-lock/src";
import * as IDBStore from "@lo-fi/client-storage/idb";

// simple helper util for showing a spinner
// (during slower passkey operations)
import { startSpinner, stopSpinner, } from "./spinner.js";


configureStorage("session-storage");


// ***********************

var passkeyKeepAliveEl;
var setPasskeyKeepAliveBtn;
var passkeyTimeoutEl;
var setPasskeyTimeoutBtn;
var registerAccountBtn;
var detectAccountBtn;
var resetAllAccountsBtn;
var selectAccountEl;
var unlockAccountBtn;
var addPasskeyBtn;
var resetAccountBtn;
var lockAccountBtn;
var accountDataEl;
var saveDataBtn;

var currentAccountID;
var localAccountIDs = await listLocalIdentities();
var passkeyTimeout = 0;

if (document.readyState == "loading") {
	document.addEventListener("DOMContentLoaded",ready,false);
}
else {
	ready();
}


// ***********************

async function ready() {
	passkeyKeepAliveEl = document.getElementById("passkey-keep-alive");
	setPasskeyKeepAliveBtn = document.getElementById("set-passkey-keep-alive-btn");
	passkeyTimeoutEl = document.getElementById("passkey-timeout");
	setPasskeyTimeoutBtn = document.getElementById("set-passkey-timeout-btn");
	registerAccountBtn = document.getElementById("register-account-btn");
	detectAccountBtn = document.getElementById("detect-account-btn");
	resetAllAccountsBtn = document.getElementById("reset-all-accounts-btn");
	selectAccountEl = document.getElementById("select-account");
	unlockAccountBtn = document.getElementById("unlock-account-btn");
	addPasskeyBtn = document.getElementById("add-passkey-btn");
	resetAccountBtn = document.getElementById("reset-account-btn");
	lockAccountBtn = document.getElementById("lock-account-btn");
	accountDataEl = document.getElementById("account-data");
	saveDataBtn = document.getElementById("save-data-btn");

	selectAccountEl.addEventListener("change",changeSelectedAccount,false);
	accountDataEl.addEventListener("input",onChangeAccountData,false);

	setPasskeyKeepAliveBtn.addEventListener("click",setKeepAlive,false);
	setPasskeyTimeoutBtn.addEventListener("click",setPasskeyTimeout,false);
	registerAccountBtn.addEventListener("click",registerAccount,false);
	detectAccountBtn.addEventListener("click",detectAccount,false);
	resetAllAccountsBtn.addEventListener("click",resetAllAccounts,false);
	unlockAccountBtn.addEventListener("click",unlockAccount,false);
	addPasskeyBtn.addEventListener("click",addPasskey,false);
	resetAccountBtn.addEventListener("click",resetAccount,false);
	lockAccountBtn.addEventListener("click",lockAccount,false);
	saveDataBtn.addEventListener("click",saveData,false);

	updateElements();
}

function updateElements() {
	selectAccountEl.disabled = (localAccountIDs.length == 0);
	selectAccountEl.options.length = 1;
	for (let localID of localAccountIDs) {
		let optionEl = document.createElement("option");
		optionEl.value = localID;
		optionEl.innerHTML = localID;
		selectAccountEl.appendChild(optionEl);
	}

	if (localAccountIDs.length > 0) {
		detectAccountBtn.disabled = false;
		resetAllAccountsBtn.disabled = false;
	}
	else {
		detectAccountBtn.disabled = true;
		resetAllAccountsBtn.disabled = true;
		unlockAccountBtn.disabled = true;
	}

	if (localAccountIDs.includes(currentAccountID)) {
		selectAccountEl.value = currentAccountID;
		addPasskeyBtn.disabled = false;
		resetAccountBtn.disabled = false;
		lockAccountBtn.disabled = false;
		accountDataEl.disabled = false;
	}
	else {
		addPasskeyBtn.disabled = true;
		resetAccountBtn.disabled = true;
		lockAccountBtn.disabled = true;
		accountDataEl.disabled = true;
		accountDataEl.value = "";
		selectAccountEl.selectedIndex = 0;
	}
}

function changeSelectedAccount() {
	if (selectAccountEl.selectedIndex > 0) {
		unlockAccountBtn.disabled = false;
	}
	else {
		unlockAccountBtn.disabled = true;
	}
}

function onChangeAccountData() {
	saveDataBtn.disabled = false;
}

async function setKeepAlive() {
	var keepAlive = Math.max(1,Number(passkeyKeepAliveEl.value != null ? passkeyKeepAliveEl.value : 30));
	passkeyKeepAliveEl.value = keepAlive;

	setMaxLockKeyCacheLifetime(keepAlive * 60 * 1000);
	showToast(`Passkey Keep-Alive set to ${keepAlive} minute(s)`);
}

async function setPasskeyTimeout() {
	passkeyTimeout = Math.max(0,Number(passkeyTimeoutEl.value != null ? passkeyTimeoutEl.value : 0));
	passkeyTimeoutEl.value = passkeyTimeout;

	if (passkeyTimeout > 0) {
		showToast(`Passkey Timeout set to ${passkeyTimeout} second(s)`);
	}
	else {
		showToast(`Passkey Timeout disabled (0 seconds)`);
	}
}

async function promptAddPasskey() {
	var passkeyUsernameEl;
	var passkeyDisplayNameEl;

	var result = await Swal.fire({
		title: "Add Passkey",
		html: `
			<p>
				<label>
					Username:
					<input type="text" id="passkey-username" class="swal2-input">
				</label>
			</p>
			<p>
				<label>
					Display Name:
					<input type="text" id="passkey-display-name" class="swal2-input">
				</label>
			</p>
		`,
		showConfirmButton: true,
		confirmButtonText: "Add",
		confirmButtonColor: "darkslateblue",
		showCancelButton: true,
		cancelButtonColor: "darkslategray",

		allowOutsideClick: true,
		allowEscapeKey: true,

		didOpen(popupEl) {
			passkeyUsernameEl = document.getElementById("passkey-username");
			passkeyDisplayNameEl = document.getElementById("passkey-display-name");
			passkeyUsernameEl.focus();
			popupEl.addEventListener("keypress",onKeypress,true);
		},

		willClose(popupEl) {
			popupEl.removeEventListener("keypress",onKeypress,true);
			passkeyUsernameEl = passkeyDisplayNameEl = null;
		},

		async preConfirm() {
			var passkeyUsername = passkeyUsernameEl.value.trim();
			var passkeyDisplayName = passkeyDisplayNameEl.value.trim();

			if (!passkeyUsername) {
				Swal.showValidationMessage("Please enter a username.");
				return false;
			}
			if (!passkeyDisplayName) {
				Swal.showValidationMessage("Please enter a display name.");
				return false;
			}

			return { passkeyUsername, passkeyDisplayName, };
		},
	});

	if (result.isConfirmed) {
		return result.value;
	}


	// ***********************

	function onKeypress(evt) {
		if (
			evt.key == "Enter" &&
			evt.target.matches(".swal2-input, .swal2-select, .swal2-textarea")
		) {
			evt.preventDefault();
			evt.stopPropagation();
			evt.stopImmediatePropagation();
			Swal.clickConfirm();
		}
	}
}

async function registerAccount() {
	var { passkeyUsername: username, passkeyDisplayName: displayName, } = (await promptAddPasskey() || {});

	if (!(username != null && displayName != null)) {
		return;
	}

	var { signal, intv } = createTimeoutToken(passkeyTimeout) || {};
	try {
		startSpinner();
		let key = await getLockKey({
			addNewPasskey: true,
			username,
			displayName,
			signal,
		});
		if (intv != null) { clearTimeout(intv); }
		localAccountIDs = await listLocalIdentities();
		if (!localAccountIDs.includes(key.localIdentity)) {
			throw new Error("No account found for selected passkey");
		}
		selectAccountEl.value = currentAccountID = key.localIdentity;
		await unlockAccountData(currentAccountID,key);
		updateElements();
		changeSelectedAccount();
		stopSpinner();
		showToast("Account (and passkey) registered.");
	}
	catch (err) {
		if (intv != null) { clearTimeout(intv); }
		logError(err);
		stopSpinner();
		showError("Registering account and passkey failed.");
	}
}

async function detectAccount() {
	var { signal, intv } = createTimeoutToken(passkeyTimeout) || {};
	try {
		startSpinner();
		let key = await getLockKey({ signal, });
		if (intv != null) { clearTimeout(intv); }
		if (!localAccountIDs.includes(key.localIdentity)) {
			throw new Error("No account matching selected passkey");
		}
		selectAccountEl.value = currentAccountID = key.localIdentity;
		await unlockAccountData(currentAccountID,key);
		updateElements();
		changeSelectedAccount();
		stopSpinner();
		showToast("Account detected and unlocked via passkey.");
	}
	catch (err) {
		if (intv != null) { clearTimeout(intv); }
		logError(err);
		stopSpinner();
		showError("Detecting account via passkey authentication failed.");
	}
}

async function resetAllAccounts() {
	var confirmResult = await Swal.fire({
		text: "Resetting will remove all local account data and passkeys. Are you sure?",
		icon: "warning",
		showConfirmButton: true,
		confirmButtonText: "Yes, reset!",
		confirmButtonColor: "darkslateblue",
		showCancelButton: true,
		cancelButtonColor: "darkslategray",
		cancelButtonText: "No",
		allowOutsideClick: true,
		allowEscapeKey: true,
	});

	if (confirmResult.isConfirmed) {
		for (let accountID of localAccountIDs) {
			await removeLocalAccount(accountID);
			await IDBStore.remove(`account-data-${accountID}`);
		}
		localAccountIDs.length = 0;
		updateElements();
		showToast("All local accounts removed.");
	}
}

async function unlockAccount() {
	if (selectAccountEl.selectedIndex == 0) {
		return;
	}

	var { signal, intv } = createTimeoutToken(passkeyTimeout) || {};
	try {
		startSpinner();
		let key = await getLockKey({
			localIdentity: selectAccountEl.value,
			signal,
		});
		if (intv != null) { clearTimeout(intv); }
		if (!localAccountIDs.includes(key.localIdentity)) {
			throw new Error("No account found for selected passkey");
		}
		selectAccountEl.value = currentAccountID = key.localIdentity;
		await unlockAccountData(currentAccountID,key);
		updateElements();
		changeSelectedAccount();
		stopSpinner();
		showToast("Account unlocked.");
	}
	catch (err) {
		if (intv != null) { clearTimeout(intv); }
		logError(err);
		stopSpinner();
		showError("Unlocking account via passkey failed.");
	}
}

async function addPasskey() {
	var { passkeyUsername: username, passkeyDisplayName: displayName, } = (await promptAddPasskey() || {});

	if (!(username != null && displayName != null)) {
		return;
	}

	var { signal, intv } = createTimeoutToken(passkeyTimeout) || {};
	try {
		startSpinner();
		let result = await getLockKey({
			localIdentity: currentAccountID,
			addNewPasskey: true,
			username,
			displayName,
			signal,
		});
		if (intv != null) { clearTimeout(intv); }
		stopSpinner();
		if (result != null) {
			showToast("Additional passkey added.");
		}
	}
	catch (err) {
		if (intv != null) { clearTimeout(intv); }
		logError(err);
		stopSpinner();
		showError("Adding new passkey failed.");
	}
}

async function resetAccount() {
	var confirmResult = await Swal.fire({
		text: "Resetting an account regenerates a new encryption/decryption key and a new passkey, while discarding previously associated passkeys. Are you sure?",
		icon: "warning",
		showConfirmButton: true,
		confirmButtonText: "Yes, reset!",
		confirmButtonColor: "darkslateblue",
		showCancelButton: true,
		cancelButtonColor: "darkslategray",
		cancelButtonText: "No",
		allowOutsideClick: true,
		allowEscapeKey: true,
	});

	if (confirmResult.isConfirmed) {
		let { passkeyUsername: username, passkeyDisplayName: displayName, } = (
			(await promptAddPasskey()) || {}
		);

		if (!(username != null && displayName != null)) {
			return;
		}

		let { signal, intv } = createTimeoutToken(passkeyTimeout) || {};
		try {
			startSpinner();
			let key = await getLockKey({
				localIdentity: currentAccountID,
				resetLockKey: true,
				username,
				displayName,
				signal,
			});
			if (intv != null) { clearTimeout(intv); }
			if (!localAccountIDs.includes(key.localIdentity)) {
				throw new Error("No account found for selected passkey");
			}
			if (accountDataEl.value != "") {
				await lockAccountData(currentAccountID,key,accountDataEl.value);
			}
			else {
				await storeAccountData(currentAccountID,"");
			}
			stopSpinner();
			showToast("Account lock-key reset (and previous passkeys discarded).");
		}
		catch (err) {
			if (intv != null) { clearTimeout(intv); }
			logError(err);
			stopSpinner();
			showError("Resetting account failed.");
		}
	}
}

async function lockAccount() {
	clearLockKeyCache(currentAccountID);
	currentAccountID = null;
	selectAccountEl.selectedIndex = 0;
	changeSelectedAccount();
	updateElements();
	showToast("Account locked.");
}

async function saveData() {
	var { signal, intv } = createTimeoutToken(passkeyTimeout) || {};
	try {
		startSpinner();
		let key = await getLockKey({
			localIdentity: currentAccountID,
			signal,
		});
		if (intv != null) { clearTimeout(intv); }
		if (accountDataEl.value != "") {
			await lockAccountData(currentAccountID,key,accountDataEl.value);
		}
		else {
			await storeAccountData(currentAccountID,"");
		}
		saveDataBtn.disabled = true;
		stopSpinner();
		showToast("Data encrypted and saved.");
	}
	catch (err) {
		if (intv != null) { clearTimeout(intv); }
		logError(err);
		stopSpinner();
		showError("Saving (encrypted!) data to account failed.");
	}
}

async function unlockAccountData(accountID,key) {
	var data = await loadAccountData(accountID);
	if (typeof data == "string") {
		if (data != "") {
			let text = unlockData(data,key,{ parseJSON: false, });
			accountDataEl.value = text;
		}
		else {
			accountDataEl.value = "";
		}
	}
	else {
		accountDataEl.value = "";
	}
}

async function lockAccountData(accountID,key,data) {
	await storeAccountData(accountID,lockData(data,key));
}

async function loadAccountData(accountID) {
	var data = await IDBStore.get(`account-data-${accountID}`);
	if (typeof data == "string") {
		return data;
	}
}

async function storeAccountData(accountID,data) {
	await IDBStore.set(`account-data-${accountID}`,data);
}

function logError(err,returnLog = false) {
	var err = `${
			err.stack ? err.stack : err.toString()
		}${
			err.cause ? `\n${logError(err.cause,/*returnLog=*/true)}` : ""
	}`;
	if (returnLog) return err;
	else console.error(err);
}

function showError(errMsg) {
	return Swal.fire({
		title: "Error!",
		text: errMsg,
		icon: "error",
		confirmButtonText: "OK",
	});
}

function showToast(toastMsg) {
	return Swal.fire({
		text: toastMsg,
		showConfirmButton: false,
		showCloseButton: true,
		timer: 5000,
		toast: true,
		position: "top-end",
		customClass: {
			popup: "toast-popup",
		},
	});
}

function createTimeoutToken(seconds) {
	if (seconds > 0) {
		let ac = new AbortController();
		let intv = setTimeout(() => ac.abort("Timeout!"),seconds * 1000);
		return { signal: ac.signal, intv, };
	}
}
