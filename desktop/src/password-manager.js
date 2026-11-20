// Fills sign-in forms from 1Password, through 1Password's command-line tool (op) and its
// connection to the 1Password app, which asks you to approve (Touch ID) before handing anything
// over. The app keeps nothing: each fill asks 1Password again.
//
// Only on your command (menu, shortcut or right-click), only into visible fields of the page in
// front of you, and only with a sign-in saved for that website.

const { execFile } = require('node:child_process');
const fs = require('node:fs');

const OP_PATHS = ['/opt/homebrew/bin/op', '/usr/local/bin/op', 'C:\\Program Files\\1Password CLI\\op.exe'];
const findOp = () => OP_PATHS.find((p) => {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}) || null;

const SETUP_URL = 'https://developer.1password.com/docs/cli/get-started/';

function runOp(opPath, args) {
  return new Promise((resolve, reject) => {
    execFile(opPath, args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().replace(/^\[ERROR\]\s*[\d/: ]*/, '')));
      else resolve(stdout);
    });
  });
}

// "id.atlassian.com" and "atlassian.com" are one website, as are "accounts.google.com" and
// "google.com", and "login.example.co.uk" and "example.co.uk".
function siteOf(host) {
  const labels = String(host).toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const [second, top] = labels.slice(-2);
  const countrySecondLevel = top.length === 2 && ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ltd', 'plc', 'me'].includes(second);
  return labels.slice(countrySecondLevel ? -3 : -2).join('.');
}
const hostOf = (href) => {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(href) ? href : `https://${href}`).hostname.toLowerCase();
  } catch {
    return null;
  }
};

// Runs in a world of its own inside the page, so the page's scripts can't interfere with it.
const WORLD = 4242;
const FINDER = `
  const shown = (el) => {
    if (el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const words = (i) => [i.name, i.id, i.autocomplete, i.placeholder, i.getAttribute('aria-label'),
    ...[...(i.labels || [])].map((l) => l.textContent)].join(' ').toLowerCase();
  const isText = (i) => ['text', 'email', 'tel', 'number'].includes(i.type);
  const inputs = [...document.querySelectorAll('input')].filter(shown);
  const password = inputs.find((i) => i.type === 'password' && i.autocomplete !== 'new-password');
  const otp = inputs.find((i) => isText(i) && (i.autocomplete === 'one-time-code' ||
    /\\b(otp|totp|one[- ]?time|2fa|mfa|verification|authenticat\\w*|security code)\\b/.test(words(i))));
  let username = inputs.find((i) => i !== otp && isText(i) &&
    (/\\b(username|email)\\b/.test(i.autocomplete) || i.type === 'email' || /user|e-?mail|login/.test(words(i))));
  if (!username && password) username = inputs.slice(0, inputs.indexOf(password)).reverse().find((i) => i !== otp && isText(i));
`;
const DETECT = `(() => {
  ${FINDER}
  return { host: location.hostname, secure: location.protocol === 'https:', username: !!username, password: !!password, otp: !!otp };
})()`;
const fillCode = (values) => `(() => {
  ${FINDER}
  const v = ${JSON.stringify(values)};
  const set = (el, value) => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  let filled = 0;
  if (username && v.username) { set(username, v.username); filled++; }
  if (password && v.password) { set(password, v.password); filled++; }
  if (otp && v.otp) { set(otp, v.otp); filled++; }
  return filled;
})()`;

// Fill the sign-in form on the page shown in `wc`. `choose(items)` picks one of several saved
// sign-ins (or null). Returns { ok } or { message, detail, needsSetup, cancelled }.
async function fill(wc, { opPath, choose }) {
  const run = (code) => wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]);
  const page = await run(DETECT).catch(() => null);
  if (!page || (!page.username && !page.password && !page.otp)) {
    return { message: 'There’s no sign-in form on this page.', detail: 'Click into the page’s sign-in form first if it hasn’t appeared yet.' };
  }
  if (!page.secure) return { message: 'Sign-ins are only filled into secure (https) pages.' };
  if (!opPath) {
    return {
      needsSetup: true,
      message: 'To fill sign-ins from 1Password, install 1Password’s command-line tool.',
      detail: 'Then, in 1Password, open Settings → Developer and turn on “Integrate with 1Password CLI”.',
    };
  }

  let items;
  try {
    items = JSON.parse(await runOp(opPath, ['item', 'list', '--categories', 'Login', '--format', 'json']));
  } catch (err) {
    return {
      needsSetup: true,
      message: 'Couldn’t get sign-ins from 1Password.',
      detail: `${err.message}\n\nCheck that 1Password is open and unlocked, and that “Integrate with 1Password CLI” is on in 1Password → Settings → Developer.`,
    };
  }
  const site = siteOf(page.host);
  const matches = (Array.isArray(items) ? items : []).filter((it) =>
    (it.urls || []).some((u) => {
      const h = hostOf(u.href);
      return !!h && siteOf(h) === site;
    }));
  if (!matches.length) return { message: `1Password has no sign-in saved for ${page.host}.` };
  const item = matches.length === 1 ? matches[0] : await choose(matches);
  if (!item) return { cancelled: true };

  const at = item.vault?.id ? ['--vault', item.vault.id] : [];
  let fields;
  try {
    fields = JSON.parse(await runOp(opPath, ['item', 'get', item.id, ...at, '--format', 'json', '--reveal'])).fields || [];
  } catch (err) {
    return { message: `Couldn’t get “${item.title}” from 1Password.`, detail: err.message };
  }
  const values = {
    username: page.username ? fields.find((f) => f.purpose === 'USERNAME')?.value || null : null,
    password: page.password ? fields.find((f) => f.purpose === 'PASSWORD')?.value || null : null,
    otp: page.otp ? fields.find((f) => f.type === 'OTP')?.totp || null : null,
  };
  if (page.otp && !values.otp && fields.some((f) => f.type === 'OTP')) {
    values.otp = (await runOp(opPath, ['item', 'get', item.id, ...at, '--otp']).catch(() => '')).trim() || null;
  }
  fields = null;

  // 1Password may have taken a while to ask you; don't fill a page that has moved elsewhere.
  if (wc.isDestroyed() || hostOf(wc.getURL()) !== page.host) {
    return { message: 'The page changed before it could be filled. Try again.' };
  }
  const filled = await run(fillCode(values)).catch(() => 0);
  return filled ? { ok: true } : { message: `“${item.title}” has nothing to fill into this form.` };
}

module.exports = { fill, findOp, siteOf, SETUP_URL };
