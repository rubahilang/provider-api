import path from 'path';
import fs from 'fs';
import express from 'express';
import fetch from 'node-fetch';
import https from 'https';
import { URL } from 'url';
import { fileURLToPath } from 'url';
import axios from 'axios';

// Inisialisasi Express app
const app = express();

async function checkURL(urlToCheck) {
    // Pastikan URL selalu memiliki skema (http:// atau https://)
    if (!/^https?:\/\//i.test(urlToCheck)) {
        urlToCheck = 'https://' + urlToCheck; // Menambahkan https:// jika tidak ada skema
    }

    const agent = new https.Agent({ rejectUnauthorized: false }); // Menonaktifkan pengecekan sertifikat SSL
    try {
        const response = await fetch(urlToCheck, {
            redirect: 'manual', // Jangan ikuti redirect otomatis
            agent: agent, // Gunakan agent untuk SSL
        });

        // Cek status respons dan log untuk debugging
        console.log(`Status untuk ${urlToCheck}: ${response.status}`);
        console.log(`Location header: ${response.headers.get('location')}`);

        const originalDomain = getRootDomain(new URL(urlToCheck).hostname);

        // Cek status kode respons
        if (response.status >= 300 && response.status < 400) {
            const redirectLocation = response.headers.get('location');
            const redirectDomain = getRootDomain(new URL(redirectLocation).hostname);

            // Cek jika redirect mengarah ke domain yang berbeda (bukan hanya subdomain)
            if (redirectDomain !== originalDomain) {
                console.log(`Redirect ke domain berbeda: ${redirectDomain} != ${originalDomain}`);
                return { blocked: true }; // Redirect ke domain berbeda dianggap diblokir
            } else {
                console.log(`Redirect ke subdomain yang sama: ${redirectDomain} == ${originalDomain}`);
                return { blocked: false }; // Redirect ke subdomain yang sama dianggap aman
            }
        } else if (response.status === 403) {
            console.log(`URL mengembalikan 403: ${urlToCheck}`);
            return { blocked: false }; // Status 403 dianggap bukan blokir
        } else if (response.ok) {
            console.log(`URL aman: ${urlToCheck}`);
            return { blocked: false }; // Tidak ada masalah, URL aman
        } else {
            console.log(`URL tidak tersedia (status ${response.status}): ${urlToCheck}`);
            return { blocked: true }; // URL tidak tersedia, dianggap terblokir
        }
    } catch (error) {
        console.log(`Terjadi kesalahan saat memeriksa ${urlToCheck}: ${error.message}`);
        return { blocked: true }; // Terjadi kesalahan, dianggap terblokir
    }
}

// Definisikan route untuk cek status domain
app.get('/check', async (req, res) => {
    const domain = req.query.domain || req.query.domains;

    if (!domain) {
        return res.status(400).json({ error: 'Parameter "domain" atau "domains" harus disediakan.' });
    }

    // Panggil fungsi checkURL untuk mengecek status
    const result = await checkURL(domain);
    
    // Format hasil dalam objek JSON yang sesuai
    const response = {
        [domain]: result
    };

    // Kirim hasil dalam format JSON
    res.json(response);
});

// Menjalankan server di port 3000
const PORT = 3000;

// Endpoint root
app.get('/', (req, res) => {
    res.send(`
  
      <!DOCTYPE html>
      <html dir="ltr" lang="en">
      <head>
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
      <style>
      @charset "utf-8";
  
  button { border: 0px; border-radius: 20px; box-sizing: border-box; color: var(--primary-button-text-color); cursor: pointer; float: right; font-size: 0.875em; margin: 0px; padding: 8px 16px; transition: box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1); user-select: none; }
  
  [dir="rtl"] button { float: left; }
  
  .bad-clock button, .captive-portal button, .https-only button, .insecure-form button, .lookalike-url button, .main-frame-blocked button, .neterror button, .pdf button, .ssl button, .enterprise-block button, .enterprise-warn button, .managed-profile-required button, .safe-browsing-billing button, .supervised-user-verify button, .supervised-user-verify-subframe button { background: var(--primary-button-fill-color); }
  
  button:active { background: var(--primary-button-fill-color-active); outline: 0px; }
  
  #debugging { display: inline; overflow: auto; }
  
  .debugging-content { line-height: 1em; margin-bottom: 0px; margin-top: 1em; }
  
  .debugging-content-fixed-width { display: block; font-family: monospace; font-size: 1.2em; margin-top: 0.5em; }
  
  .debugging-title { font-weight: bold; }
  
  #details { margin: 0px 0px 50px; }
  
  #details p:not(:first-of-type) { margin-top: 20px; }
  
  .secondary-button:active { border-color: white; box-shadow: rgba(60, 64, 67, 0.3) 0px 1px 2px 0px, rgba(60, 64, 67, 0.15) 0px 2px 6px 2px; }
  
  .secondary-button:hover { background: var(--secondary-button-hover-fill-color); border-color: var(--secondary-button-hover-border-color); text-decoration: none; }
  
  .error-code { color: var(--error-code-color); font-size: 0.8em; margin-top: 12px; text-transform: uppercase; }
  
  #error-debugging-info { font-size: 0.8em; }
  
  h1 { color: var(--heading-color); font-size: 1.6em; font-weight: normal; line-height: 1.25em; margin-bottom: 16px; }
  
  h2 { font-size: 1.2em; font-weight: normal; }
  
  .icon { height: 72px; margin: 0px 0px 40px; width: 72px; }
  
  input[type="checkbox"] { opacity: 0; }
  
  input[type="checkbox"]:focus ~ .checkbox::after { outline: -webkit-focus-ring-color auto 5px; }
  
  .interstitial-wrapper { box-sizing: border-box; font-size: 1em; line-height: 1.6em; margin: 14vh auto 0px; max-width: 600px; width: 100%; }
  
  #main-message > p { display: inline; }
  
  #extended-reporting-opt-in { font-size: 0.875em; margin-top: 32px; }
  
  #extended-reporting-opt-in label { display: grid; grid-template-columns: 1.8em 1fr; position: relative; }
  
  #enhanced-protection-message { border-radius: 20px; font-size: 1em; margin-top: 32px; padding: 10px 5px; }
  
  #enhanced-protection-message a { color: var(--google-red-10); }
  
  #enhanced-protection-message label { display: grid; grid-template-columns: 2.5em 1fr; position: relative; }
  
  #enhanced-protection-message div { margin: 0.5em; }
  
  #enhanced-protection-message .icon { height: 1.5em; vertical-align: middle; width: 1.5em; }
  
  .nav-wrapper { margin-top: 51px; }
  
  .nav-wrapper::after { clear: both; content: ""; display: table; width: 100%; }
  
  .small-link { color: var(--small-link-color); font-size: 0.875em; }
  
  .checkboxes { flex: 0 0 24px; }
  
  .checkbox { --padding: .9em; background: transparent; display: block; height: 1em; left: -1em; padding-inline-start: var(--padding); position: absolute; right: 0px; top: -0.5em; width: 1em; }
  
  .checkbox::after { border: 1px solid white; border-radius: 2px; content: ""; height: 1em; left: var(--padding); position: absolute; top: var(--padding); width: 1em; }
  
  .checkbox::before { background: transparent; border-width: 0px 2px 2px; border-style: solid; border-color: white; border-image: initial; border-inline-end-width: 0px; content: ""; height: 0.2em; left: calc(.3em + var(--padding)); opacity: 0; position: absolute; top: calc(.3em  + var(--padding)); transform: rotate(-45deg); width: 0.5em; }
  
  input[type="checkbox"]:checked ~ .checkbox::before { opacity: 1; }
  
  #recurrent-error-message { background: rgb(237, 237, 237); border-radius: 4px; margin-bottom: 16px; margin-top: 12px; padding: 12px 16px; }
  
  .showing-recurrent-error-message #extended-reporting-opt-in { margin-top: 16px; }
  
  .showing-recurrent-error-message #enhanced-protection-message { margin-top: 16px; }
  
  @media (max-width: 700px) {
    .interstitial-wrapper { padding: 0px 10%; }
    #error-debugging-info { overflow: auto; }
  }
  
  @media (max-width: 420px) {
    button, [dir="rtl"] button, .small-link { float: none; font-size: 0.825em; font-weight: 500; margin: 0px; width: 100%; }
    button { padding: 16px 24px; }
    #details { margin: 20px 0px; }
    #details p:not(:first-of-type) { margin-top: 10px; }
    .secondary-button:not(.hidden) { display: block; margin-top: 20px; text-align: center; width: 100%; }
    .interstitial-wrapper { padding: 0px 5%; }
    #extended-reporting-opt-in { margin-top: 24px; }
    #enhanced-protection-message { margin-top: 24px; }
    .nav-wrapper { margin-top: 30px; }
  }
  
  @media (max-width: 420px) {
    .nav-wrapper .secondary-button { border: 0px; margin: 16px 0px 0px; margin-inline-end: 0px; padding-bottom: 16px; padding-top: 16px; }
  }
  
  @media (min-width: 240px) and (max-width: 420px) and (min-height: 401px), (min-width: 421px) and (min-height: 240px) and (max-height: 560px) {
    body .nav-wrapper { background: var(--background-color); bottom: 0px; box-shadow: 0 -12px 24px var(--background-color); left: 0px; margin: 0px auto; max-width: 736px; padding-inline: 24px; position: fixed; right: 0px; width: 100%; z-index: 2; }
    .interstitial-wrapper { max-width: 736px; }
    #details, #main-content { padding-bottom: 40px; }
    #details { padding-top: 5.5vh; }
    button.small-link { color: var(--google-blue-600); }
  }
  
  @media (max-width: 420px) and (orientation: portrait), (max-height: 560px) {
    body { margin: 0px auto; }
    button, [dir="rtl"] button, button.small-link, .nav-wrapper .secondary-button { font-family: Roboto-Regular, Helvetica; font-size: 0.933em; margin: 6px 0px; transform: translateZ(0px); }
    .nav-wrapper { box-sizing: border-box; padding-bottom: 8px; width: 100%; }
    #details { box-sizing: border-box; height: auto; margin: 0px; opacity: 1; transition: opacity 250ms cubic-bezier(0.4, 0, 0.2, 1); }
    #details.hidden, #main-content.hidden { height: 0px; opacity: 0; overflow: hidden; padding-bottom: 0px; transition: none; }
    h1 { font-size: 1.5em; margin-bottom: 8px; }
    .icon { margin-bottom: 5.69vh; }
    .interstitial-wrapper { box-sizing: border-box; margin: 7vh auto 12px; padding: 0px 24px; position: relative; }
    .interstitial-wrapper p { font-size: 0.95em; line-height: 1.61em; margin-top: 8px; }
    #main-content { margin: 0px; transition: opacity 100ms cubic-bezier(0.4, 0, 0.2, 1); }
    .small-link { border: 0px; }
    .suggested-left > #control-buttons, .suggested-right > #control-buttons { float: none; margin: 0px; }
  }
  
  @media (min-width: 421px) and (min-height: 500px) and (max-height: 560px) {
    .interstitial-wrapper { margin-top: 10vh; }
  }
  
  @media (min-height: 400px) and (orientation: portrait) {
    .interstitial-wrapper { margin-bottom: 145px; }
  }
  
  @media (min-height: 299px) {
    .nav-wrapper { padding-bottom: 16px; }
  }
  
  @media (max-height: 560px) and (min-height: 240px) and (orientation: landscape) {
    .extended-reporting-has-checkbox #details { padding-bottom: 80px; }
  }
  
  @media (min-height: 500px) and (max-height: 650px) and (max-width: 414px) and (orientation: portrait) {
    .interstitial-wrapper { margin-top: 7vh; }
  }
  
  @media (min-height: 650px) and (max-width: 414px) and (orientation: portrait) {
    .interstitial-wrapper { margin-top: 10vh; }
  }
  
  @media (max-height: 400px) and (orientation: portrait), (max-height: 239px) and (orientation: landscape), (max-width: 419px) and (max-height: 399px) {
    .interstitial-wrapper { display: flex; flex-direction: column; margin-bottom: 0px; }
    #details { flex: 1 1 auto; order: 0; }
    #main-content { flex: 1 1 auto; order: 0; }
    .nav-wrapper { flex: 0 1 auto; margin-top: 8px; order: 1; padding-inline: 0px; position: relative; width: 100%; }
    button, .nav-wrapper .secondary-button { padding: 16px 24px; }
    button.small-link { color: var(--google-blue-600); }
  }
  
  @media (max-width: 239px) and (orientation: portrait) {
    .nav-wrapper { padding-inline: 0px; }
  }
  
  @charset "utf-8"; a {
      color: var(--link-color);
  }
  
  body {
      --background-color: #fff;
      --error-code-color: var(--google-gray-700);
      --google-blue-50: rgb(232, 240, 254);
      --google-blue-100: rgb(210, 227, 252);
      --google-blue-300: rgb(138, 180, 248);
      --google-blue-600: rgb(26, 115, 232);
      --google-blue-700: rgb(25, 103, 210);
      --google-gray-100: rgb(241, 243, 244);
      --google-gray-300: rgb(218, 220, 224);
      --google-gray-500: rgb(154, 160, 166);
      --google-gray-50: rgb(248, 249, 250);
      --google-gray-600: rgb(128, 134, 139);
      --google-gray-700: rgb(95, 99, 104);
      --google-gray-800: rgb(60, 64, 67);
      --google-gray-900: rgb(32, 33, 36);
      --heading-color: var(--google-gray-900);
      --link-color: rgb(88, 88, 88);
      --popup-container-background-color: rgba(0,0,0,.65);
      --primary-button-fill-color-active: var(--google-blue-700);
      --primary-button-fill-color: var(--google-blue-600);
      --primary-button-text-color: #fff;
      --quiet-background-color: rgb(247, 247, 247);
      --secondary-button-border-color: var(--google-gray-500);
      --secondary-button-fill-color: #fff;
      --secondary-button-hover-border-color: var(--google-gray-600);
      --secondary-button-hover-fill-color: var(--google-gray-50);
      --secondary-button-text-color: var(--google-gray-700);
      --small-link-color: var(--google-gray-700);
      --text-color: var(--google-gray-700);
      background: var(--background-color);
      color: var(--text-color);
      overflow-wrap: break-word;
  }
  
  .nav-wrapper .secondary-button {
      background: var(--secondary-button-fill-color);
      border: 1px solid var(--secondary-button-border-color);
      color: var(--secondary-button-text-color);
      float: none;
      margin: 0px;
      padding: 8px 16px;
  }
  
  .hidden {
      display: none;
  }
  
  html {
      text-size-adjust: 100%;
      font-size: 125%;
  }
  
  .icon {
      background-repeat: no-repeat;
      background-size: 100%;
  }
  
  @media (prefers-color-scheme: dark) {
      body {
          --background-color: var(--google-gray-900);
          --error-code-color: var(--google-gray-500);
          --heading-color: var(--google-gray-500);
          --link-color: var(--google-blue-300);
          --primary-button-fill-color-active: rgb(129, 162, 208);
          --primary-button-fill-color: var(--google-blue-300);
          --primary-button-text-color: var(--google-gray-900);
          --quiet-background-color: var(--background-color);
          --secondary-button-border-color: var(--google-gray-700);
          --secondary-button-fill-color: var(--google-gray-900);
          --secondary-button-hover-fill-color: rgb(48, 51, 57);
          --secondary-button-text-color: var(--google-blue-300);
          --small-link-color: var(--google-blue-300);
          --text-color: var(--google-gray-500);
      }
  }
  
  @charset "utf-8"; html[subframe] #main-frame-error {
      display: none;
  }
  
  html:not([subframe]) #sub-frame-error {
      display: none;
  }
  
  h1 {
      margin-top: 0px;
      overflow-wrap: break-word;
  }
  
  h1 span {
      font-weight: 500;
  }
  
  a {
      text-decoration: none;
  }
  
  .icon {
      user-select: none;
      display: inline-block;
  }
  
  .icon-generic {
      content: image-set(url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABIAQMAAABvIyEEAAAABlBMVEUAAABTU1OoaSf/AAAAAXRSTlMAQObYZgAAAENJREFUeF7tzbEJACEQRNGBLeAasBCza2lLEGx0CxFGG9hBMDDxRy/72O9FMnIFapGylsu1fgoBdkXfUHLrQgdfrlJN1BdYBjQQm3UAAAAASUVORK5CYII=") 1x, url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAACQAQMAAADdiHD7AAAABlBMVEUAAABTU1OoaSf/AAAAAXRSTlMAQObYZgAAAFJJREFUeF7t0cENgDAMQ9FwYgxG6WjpaIzCCAxQxVggFuDiCvlLOeRdHR9yzjncHVoq3npu+wQUrUuJHylSTmBaespJyJQoObUeyxDQb3bEm5Au81c0pSCD8HYAAAAASUVORK5CYII=") 2x);
  }
  
  .icon-info {
      content: image-set(url("data:image/png;base64,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") 1x, url("data:image/png;base64,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") 2x) no-repeat;
      content: "";
      display: inline-block;
      height: 24px;
      margin-inline: -4px 4px; vertical-align: middle;
      width: 24px;
  }
  
  #download-button:disabled {
      background: rgb(180, 206, 249);
      color: rgb(255, 255, 255);
  }
  
  #buttons::after {
      clear: both;
      content: "";
      display: block;
      width: 100%;
  }
  
  html[dir="rtl"] .runner-container, html[dir="rtl"].offline .icon-offline {
      transform: scaleX(-1);
  }
  
  .offline {
      transition: filter 1.5s cubic-bezier(0.65, 0.05, 0.36, 1), background-color 1.5s cubic-bezier(0.65, 0.05, 0.36, 1);
      will-change: filter, background-color;
  }
  
  .offline body {
      transition: background-color 1.5s cubic-bezier(0.65, 0.05, 0.36, 1);
  }
  
  .offline #main-message > p {
      display: none;
  }
  
  .offline.inverted {
      background-color: rgb(255, 255, 255);
      filter: invert(1);
  }
  
  .offline.inverted body {
      background-color: rgb(255, 255, 255);
  }
  
  .offline .interstitial-wrapper {
      color: var(--text-color);
      font-size: 1em;
      line-height: 1.55;
      margin: 0px auto;
      max-width: 600px;
      padding-top: 100px;
      position: relative;
      width: 100%;
  }
  
  .offline .runner-container {
      direction: ltr;
      height: 150px;
      max-width: 600px;
      overflow: hidden;
      position: absolute;
      top: 35px;
      width: 44px;
  }
  
  .offline .runner-container:focus {
      outline: none;
  }
  
  .offline .runner-container:focus-visible {
      outline: 3px solid var(--google-blue-300);
  }
  
  .offline .runner-canvas {
      height: 150px;
      max-width: 600px;
      opacity: 1;
      overflow: hidden;
      position: absolute;
      top: 0px;
      z-index: 10;
  }
  
  .offline .controller {
      height: 100vh;
      left: 0px;
      position: absolute;
      top: 0px;
      width: 100vw;
      z-index: 9;
  }
  
  #offline-resources {
      display: none;
  }
  
  #offline-instruction {
      image-rendering: pixelated;
      left: 0px;
      margin: auto;
      position: absolute;
      right: 0px;
      top: 60px;
      width: fit-content;
  }
  
  .offline-runner-live-region {
      bottom: 0px;
      clip-path: polygon(0px 0px, 0px 0px, 0px 0px);
      color: var(--background-color);
      display: block;
      font-size: xx-small;
      overflow: hidden;
      position: absolute;
      text-align: center;
      transition: color 1.5s cubic-bezier(0.65, 0.05, 0.36, 1);
      user-select: none;
  }
  
  .slow-speed-option {
      align-items: center;
      background: var(--google-gray-50);
      border-radius: 24px / 50%;
      bottom: 0px;
      color: var(--error-code-color);
      display: inline-flex;
      font-size: 1em;
      left: 0px;
      line-height: 1.1em;
      margin: 5px auto;
      padding: 2px 12px 3px 20px;
      position: absolute;
      right: 0px;
      width: max-content;
      z-index: 999;
  }
  
  .slow-speed-option.hidden {
      display: none;
  }
  
  .slow-speed-option [type="checkbox"] {
      opacity: 0;
      pointer-events: none;
      position: absolute;
  }
  
  .slow-speed-option .slow-speed-toggle {
      cursor: pointer;
      margin-inline-start: 8px; padding: 8px 4px;
      position: relative;
  }
  
  .slow-speed-option [type="checkbox"]:disabled ~ .slow-speed-toggle {
      cursor: default;
  }
  
  .slow-speed-option-label [type="checkbox"] {
      opacity: 0;
      pointer-events: none;
      position: absolute;
  }
  
  .slow-speed-option .slow-speed-toggle::before, .slow-speed-option .slow-speed-toggle::after {
      content: "";
      display: block;
      margin: 0px 3px;
      transition: 100ms cubic-bezier(0.4, 0, 1, 1);
  }
  
  .slow-speed-option .slow-speed-toggle::before {
      background: rgb(189, 193, 198);
      border-radius: 0.65em;
      height: 0.9em;
      width: 2em;
  }
  
  .slow-speed-option .slow-speed-toggle::after {
      background: rgb(255, 255, 255);
      border-radius: 50%;
      box-shadow: rgba(0, 0, 0, 0.4) 0px 1px 3px 0px;
      height: 1.2em;
      position: absolute;
      top: 51%;
      transform: translate(-20%, -50%);
      width: 1.1em;
  }
  
  .slow-speed-option [type="checkbox"]:focus + .slow-speed-toggle {
      box-shadow: rgb(94, 158, 214) 0px 0px 8px;
      outline: rgb(93, 157, 213) solid 1px;
  }
  
  .slow-speed-option [type="checkbox"]:checked + .slow-speed-toggle::before {
      background: var(--google-blue-600);
      opacity: 0.5;
  }
  
  .slow-speed-option [type="checkbox"]:checked + .slow-speed-toggle::after {
      background: var(--google-blue-600);
      transform: translate(calc(-90% + 2em), -50%);
  }
  
  .slow-speed-option [type="checkbox"]:checked:disabled + .slow-speed-toggle::before {
      background: rgb(189, 193, 198);
  }
  
  .slow-speed-option [type="checkbox"]:checked:disabled + .slow-speed-toggle::after {
      background: var(--google-gray-50);
  }
  
  @media (max-width: 420px) {
      #download-button {
          padding-bottom: 12px;
          padding-top: 12px;
      }
  
      .suggested-left > #control-buttons, .suggested-right > #control-buttons {
          float: none;
      }
  
      .snackbar {
          border-radius: 0px;
          bottom: 0px;
          left: 0px;
          width: 100%;
      }
  }
  
  @media (max-height: 350px) {
      h1 {
          margin: 0px 0px 15px;
      }
  
      .icon-offline {
          margin: 0px 0px 10px;
      }
  
      .interstitial-wrapper {
          margin-top: 5%;
      }
  
      .nav-wrapper {
          margin-top: 30px;
      }
  }
  
  @media (min-width: 420px) and (max-width: 736px) and (min-height: 240px) and (max-height: 420px) and (orientation: landscape) {
      .interstitial-wrapper {
          margin-bottom: 100px;
      }
  }
  
  @media (max-width: 360px) and (max-height: 480px) {
      .offline .interstitial-wrapper {
          padding-top: 60px;
      }
  
      .offline .runner-container {
          top: 8px;
      }
  }
  
  @media (min-height: 240px) and (orientation: landscape) {
      .offline .interstitial-wrapper {
          margin-bottom: 90px;
      }
  
      .icon-offline {
          margin-bottom: 20px;
      }
  }
  
  @media (max-height: 320px) and (orientation: landscape) {
      .icon-offline {
          margin-bottom: 0px;
      }
  
      .offline .runner-container {
          top: 10px;
      }
  }
  
  @media (max-width: 240px) {
      button {
          padding-inline: 12px;
      }
  
      .interstitial-wrapper {
          overflow: inherit;
          padding: 0px 8px;
      }
  }
  
  @media (max-width: 120px) {
      button {
          width: auto;
      }
  }
  
  .arcade-mode, .arcade-mode .runner-container, .arcade-mode .runner-canvas {
      image-rendering: pixelated;
      max-width: 100%;
      overflow: hidden;
  }
  
  .arcade-mode #buttons, .arcade-mode #main-content {
      opacity: 0;
      overflow: hidden;
  }
  
  .arcade-mode .interstitial-wrapper {
      height: 100vh;
      max-width: 100%;
      overflow: hidden;
  }
  
  .arcade-mode .runner-container {
      left: 0px;
      margin: auto;
      right: 0px;
      transform-origin: center top;
      transition: transform 250ms cubic-bezier(0.4, 0, 1, 1) 400ms;
      z-index: 2;
  }
  
  @media (prefers-color-scheme: dark) {
      .icon {
          filter: invert(1);
      }
  
      .offline .runner-canvas {
          filter: invert(1);
      }
  
      .offline.inverted {
          background-color: var(--background-color);
          filter: invert(0);
      }
  
      .offline.inverted body {
          background-color: rgb(255, 255, 255);
      }
  
      .offline.inverted .offline-runner-live-region {
          color: rgb(255, 255, 255);
      }
  
      #suggestions-list a {
          color: var(--link-color);
      }
  
      #error-information-button {
          filter: invert(0.6);
      }
  
      .slow-speed-option {
          background: var(--google-gray-800);
          color: var(--google-gray-100);
      }
  
      .slow-speed-option .slow-speed-toggle::before, .slow-speed-option [type="checkbox"]:checked:disabled + .slow-speed-toggle::before {
          background: rgb(189, 193, 198);
      }
  
      .slow-speed-option [type="checkbox"]:checked + .slow-speed-toggle::after, .slow-speed-option [type="checkbox"]:checked + .slow-speed-toggle::before {
          background: var(--google-blue-300);
      }
  }
  
      </style>
    
      <meta name="color-scheme" content="light dark">
      <meta name="theme-color" content="#fff">
      <meta name="viewport" content="width=device-width, initial-scale=1.0,
                                     maximum-scale=1.0, user-scalable=no">
      <title>This site can't be reached</title>
    </head>
    <body class="neterror" style="font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 75%" jstcache="0">
      <div id="main-frame-error" class="interstitial-wrapper" jstcache="0">
        <div id="main-content" jstcache="0">
          <div class="icon icon-generic" jstcache="0"></div>
          <div id="main-message" jstcache="0">
            <h1 jstcache="0">
              <span jsselect="heading" jsvalues=".innerHTML:msg" jstcache="9">This site can't be reached</span>
              <a id="error-information-button" class="hidden" jstcache="0"></a>
            </h1>
            <p jsselect="summary" jsvalues=".innerHTML:msg" jstcache="1">Check if there is a typo in <span jscontent="hostName" jstcache="22">this address</span>.</p>
            <!--The suggestion list and error code are normally presented inline,
              in which case error-information-popup-* divs have no effect. When
              error-information-popup-container has the use-popup-container class, this
              information is provided in a popup instead.-->
            <div id="error-information-popup-container" jstcache="0">
              <div id="error-information-popup" jstcache="0">
                <div id="error-information-popup-box" jstcache="0">
                  <div id="error-information-popup-content" jstcache="0">
                    <div id="suggestions-list" style="" jsdisplay="(suggestionsSummaryList &amp;&amp; suggestionsSummaryList.length)" jstcache="16">
                      <p jsvalues=".innerHTML:suggestionsSummaryListHeader" jstcache="18"></p>
                      <ul jsvalues=".className:suggestionsSummaryList.length == 1 ? 'single-suggestion' : ''" jstcache="19" class="single-suggestion">
                        <li jsselect="suggestionsSummaryList" jsvalues=".innerHTML:summary" jstcache="21" jsinstance="*0">If spelling is correct, <a id="diagnose-link" jstcache="0">try running Windows Network Diagnostics</a>.</li>
                      </ul>
                    </div>
                    <div class="error-code" jscontent="errorCode" jstcache="17">DNS_PROBE_FINISHED_NXDOMAIN</div>
                    <p id="error-information-popup-close" jstcache="0">
                      <a class="link-button" jscontent="closeDescriptionPopup" jstcache="20">null</a>
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div id="download-links-wrapper" class="hidden" jstcache="0">
              <div id="download-link-wrapper" jstcache="0">
                <a id="download-link" class="link-button" jsselect="downloadButton" jscontent="msg" jsvalues=".disabledText:disabledMsg" jstcache="6" style="display: none;">
                </a>
              </div>
              <div id="download-link-clicked-wrapper" class="hidden" jstcache="0">
                <div id="download-link-clicked" class="link-button" jsselect="downloadButton" jscontent="disabledMsg" jstcache="11" style="display: none;">
                </div>
              </div>
            </div>
            <div id="save-page-for-later-button" class="hidden" jstcache="0">
              <a class="link-button" jsselect="savePageLater" jscontent="savePageMsg" jstcache="10" style="display: none;">
              </a>
            </div>
            <div id="cancel-save-page-button" class="hidden" jsselect="savePageLater" jsvalues=".innerHTML:cancelMsg" jstcache="4" style="display: none;">
            </div>
            
          </div>
        </div>
        <div id="buttons" class="nav-wrapper suggested-left" jstcache="0">
          <div id="control-buttons" jstcache="0">
            <button id="reload-button" class="blue-button text-button" jsselect="reloadButton" jsvalues=".url:reloadUrl" jscontent="msg" jstcache="5">Reload</button>
            <button id="download-button" class="blue-button text-button" jsselect="downloadButton" jscontent="msg" jsvalues=".disabledText:disabledMsg" jstcache="6" style="display: none;">
            </button>
          </div>
          <button id="details-button" class="secondary-button text-button small-link" jscontent="details" jsdisplay="(suggestionsDetails &amp;&amp; suggestionsDetails.length > 0) || diagnose" jsvalues=".detailsText:details; .hideDetailsText:hideDetails;" jstcache="2" style="display: none;"></button>
        </div>
        <div id="details" class="hidden" jstcache="0">
          <div class="suggestions" jsselect="suggestionsDetails" jstcache="3" jsinstance="*0" style="display: none;">
            <div class="suggestion-header" jsvalues=".innerHTML:header" jstcache="7"></div>
            <div class="suggestion-body" jsvalues=".innerHTML:body" jstcache="8"></div>
          </div>
        </div>
      </div>
      <div id="sub-frame-error" jstcache="0">
        <!-- Show details when hovering over the icon, in case the details are
             hidden because they're too large. -->
        <div class="icon" jstcache="0"></div>
        <div id="sub-frame-error-details" jsselect="summary" jsvalues=".innerHTML:msg" jstcache="1">Check if there is a typo in <span jscontent="hostName" jstcache="22">this address</span>.</div>
      </div>
    
    </body>
    </html>
    
    `);
  });

// Karena kita berada di modul ES, tentukan __dirname secara manual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mendapatkan path absolut untuk file server.json di direktori saat ini
const serverFilePath = path.join(__dirname, 'server.json');

// Fungsi untuk membaca nilai server dari file server.json
function getServer() {
  try {
    const data = fs.readFileSync(serverFilePath, 'utf8');
    const servers = JSON.parse(data);
    // Mengambil server pertama dari array
    return servers[0].server;
  } catch (error) {
    console.error('Error membaca atau parsing server.json:', error);
    return null;
  }
}

// Fungsi untuk melakukan request ke URL dengan parameter server
async function fetchData() {
  const server = getServer();
  if (!server) {
    console.error('Server tidak ditemukan. Pastikan file server.json valid.');
    return;
  }

  const url = `https://robotipos.com/provider-server/?server=${server}`;
  try {
    const response = await axios.get(url);
    console.log(`Response pada ${new Date().toLocaleString()}:`, response.data);
  } catch (error) {
    console.error(`Terjadi kesalahan saat mem-fetch data: ${error.message}`);
  }
}

// Melakukan fetch data segera saat script dijalankan
fetchData();

// Mengatur interval untuk memanggil fetchData setiap 1 menit (60000 ms)
setInterval(fetchData, 60 * 1000);

// Jalankan server
app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});
