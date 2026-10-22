/*
 * "Live from NASA" section on the home page.
 * Data comes from our own server (/api/nasa/*), which calls NASA's public APIs:
 *   APOD · NeoWs (near-Earth objects) · Exoplanet Archive
 * Every card shows its source link, so players and judges can verify the data.
 */
(function () {
  'use strict';

  var apodBox = document.getElementById('live-apod');
  var neoBox = document.getElementById('live-neo');
  var exoBox = document.getElementById('live-exo');
  if (!apodBox || !window.SS) return;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function link(href, text) {
    var a = el('a', 'live-src', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  // Keep the heading, replace everything else in the card.
  function reset(box) {
    while (box.children.length > 1) box.removeChild(box.lastChild);
  }

  function fail(box) {
    reset(box);
    var p = el('p', 'live-status', window.SSLang ? window.SSLang.t('live.error', 'NASA is not reachable right now. Please try again soon.') : 'NASA is not reachable right now. Please try again soon.');
    box.appendChild(p);
  }

  function get(path) {
    return window.SS.api(path).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  var number = function (n) { return Number(n).toLocaleString(); };

  // ── APOD ──
  get('/api/nasa/apod').then(function (d) {
    reset(apodBox);
    if (d.url) {
      var img = el('img', 'live-img');
      img.src = d.url;
      img.alt = d.title;
      img.loading = 'lazy';
      apodBox.appendChild(img);
    }
    apodBox.appendChild(el('h4', 'live-title', d.title));
    var text = d.explanation.length > 320 ? d.explanation.slice(0, 320).replace(/\s+\S*$/, '') + '…' : d.explanation;
    apodBox.appendChild(el('p', 'live-text', text));
    apodBox.appendChild(el('p', 'live-credit', 'Credit: ' + d.copyright + ' · ' + d.date));
    apodBox.appendChild(link(d.source, 'Source: NASA APOD ↗'));
  }).catch(function () { fail(apodBox); });

  // ── Near-Earth objects ──
  get('/api/nasa/neo').then(function (d) {
    reset(neoBox);
    neoBox.appendChild(el('p', 'live-text', number(d.count) + ' near-Earth objects are tracked today (' + d.date + '). Closest approaches:'));
    var list = el('ul', 'live-list');
    d.objects.slice(0, 5).forEach(function (o) {
      var li = el('li');
      var name = o.link ? link(o.link, o.name) : el('strong', '', o.name);
      li.appendChild(name);
      li.appendChild(el('span', o.hazardous ? 'live-tag warn' : 'live-tag', o.hazardous ? 'potentially hazardous' : 'not hazardous'));
      li.appendChild(el('small', '', '~' + number(o.diameterM) + ' m wide · misses Earth by ' + number(o.missKm) + ' km · ' + o.speedKps + ' km/s'));
      list.appendChild(li);
    });
    neoBox.appendChild(list);
    neoBox.appendChild(link(d.source, 'Source: NASA NeoWs / JPL CNEOS ↗'));
  }).catch(function () { fail(neoBox); });

  // ── Exoplanets ──
  get('/api/nasa/exoplanets').then(function (d) {
    reset(exoBox);
    var wrap = el('div', 'live-table-wrap');
    var table = el('table', 'live-table');
    var head = el('tr');
    ['Planet', 'Star', 'Found', 'Size (× Earth)', 'Year length (days)', 'Distance (light-years)'].forEach(function (h) {
      head.appendChild(el('th', '', h));
    });
    table.appendChild(head);
    d.planets.forEach(function (p) {
      var row = el('tr');
      [p.name, p.star, p.year, p.radiusEarth != null ? p.radiusEarth.toFixed(1) : '–',
       p.periodDays != null ? p.periodDays.toFixed(1) : '–', p.distanceLy != null ? number(p.distanceLy) : '–']
        .forEach(function (v) { row.appendChild(el('td', '', String(v))); });
      table.appendChild(row);
    });
    wrap.appendChild(table);
    exoBox.appendChild(wrap);
    exoBox.appendChild(link(d.source, 'Source: NASA Exoplanet Archive ↗'));
  }).catch(function () { fail(exoBox); });
})();
