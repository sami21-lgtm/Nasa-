/*
 * Login + Register forms, and the logout button in the game's top bar.
 * Needs js/config.js and js/gate.js loaded before it.
 */
(function () {
  'use strict';

  var registerForm = document.getElementById('register-form');
  var loginForm = document.getElementById('login-form');
  var message = document.getElementById('auth-message');

  function t(key, fallback) {
    return window.SSLang ? window.SSLang.t(key, fallback) : fallback;
  }

  function say(text, isError) {
    if (!message) return;
    message.textContent = text;
    message.style.color = isError ? '#ff9a8a' : '';
  }

  async function send(endpoint, data) {
    var response;
    try {
      response = await window.SS.api(endpoint, { method: 'POST', body: JSON.stringify(data) });
    } catch (e) {
      throw new Error('Cannot reach the SpaceSkribble server. Check your internet and try again.');
    }
    var result = {};
    try { result = await response.json(); } catch (e) { /* not JSON */ }
    if (!response.ok) throw new Error(result.message || 'Request failed (' + response.status + ').');
    return result;
  }

  // Save the session and go into the game.
  function enterGame(result, firstName) {
    if (!result || !result.token || !result.user) {
      throw new Error('The server did not return a login session.');
    }
    window.SS.setUser(result.user, result.token);
    say(t('auth.welcome', 'Welcome') + ', ' + (firstName || result.user.name) + '! ' + t('auth.launching', 'Launching mission…'));
    setTimeout(function () { location.href = window.SS.safeNext(); }, 600);
  }

  function lockForm(form, locked) {
    var button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = locked;
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      say(t('auth.loggingIn', 'Logging in…'));
      lockForm(loginForm, true);
      try {
        var result = await send('/api/login', {
          email: document.getElementById('login-email').value.trim(),
          password: document.getElementById('login-password').value
        });
        enterGame(result);
      } catch (error) {
        say(error.message || 'Login failed.', true);
        lockForm(loginForm, false);
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      say(t('auth.creating', 'Creating account…'));
      lockForm(registerForm, true);
      try {
        var result = await send('/api/register', {
          name: document.getElementById('reg-name').value.trim(),
          email: document.getElementById('reg-email').value.trim(),
          password: document.getElementById('reg-password').value,
          question: document.getElementById('security-question').value,
          answer: document.getElementById('security-answer').value.trim()
        });
        // The server logs the new player in, so go straight to the game.
        enterGame(result);
      } catch (error) {
        say(error.message || 'Registration failed.', true);
        lockForm(registerForm, false);
      }
    });
  }

  // Game page: logout button + profile link
  var logout = document.getElementById('logout-btn');
  if (logout) logout.addEventListener('click', function () { window.SS.logout(); });

  var user = window.SS && window.SS.getUser();
  var profile = document.getElementById('profile-link');
  if (profile && user) {
    profile.hidden = false;
    profile.title = 'My Profile — ' + (user.name || user.email || '');
  }
})();
