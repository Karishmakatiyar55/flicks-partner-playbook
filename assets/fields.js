/* Turns every slider inside a root element into a slider + typeable number box.
   Markup it expects:
     <label for="cpm">Label text <output></output></label>
     <input id="cpm" type="range" ... data-pre="₹" data-suf="%">
   The number box becomes the value calculations read; the slider just drives it. */
(function () {
  function fill(r) {
    var min = +r.min, max = +r.max, v = +r.value;
    r.style.setProperty('--p', (max > min ? (v - min) / (max - min) * 100 : 0) + '%');
  }

  function make(root, onChange) {
    var ranges = root.querySelectorAll('input[type=range]');
    Array.prototype.forEach.call(ranges, function (r) {
      var lab = root.querySelector('label[for="' + r.id + '"]');
      if (!lab || r.dataset.fieldReady) return;
      r.dataset.fieldReady = '1';
      var text = lab.textContent.trim();
      var out = lab.querySelector('output');
      var f = document.createElement('span');
      f.className = 'field';
      if (r.dataset.pre) { var a = document.createElement('span'); a.className = 'adorn'; a.textContent = r.dataset.pre; f.appendChild(a); }
      var n = document.createElement('input');
      n.type = 'number'; n.inputMode = 'decimal'; n.step = 'any'; n.min = '0';
      n.id = 'n-' + r.id; n.value = r.value;
      f.appendChild(n);
      if (r.dataset.suf) { var b = document.createElement('span'); b.className = 'adorn'; b.textContent = r.dataset.suf; f.appendChild(b); }
      if (out) out.replaceWith(f); else lab.appendChild(f);
      lab.setAttribute('for', n.id);
      r.setAttribute('aria-label', text + ' slider');
      r.addEventListener('input', function () { n.value = r.value; fill(r); onChange(); });
      n.addEventListener('input', function () {
        var v = parseFloat(n.value);
        if (isNaN(v) || v < 0) return;
        if (v > +r.max) r.max = v;
        if (v < +r.min) r.min = v;
        r.value = v; fill(r); onChange();
      });
      n.addEventListener('blur', function () { if (n.value === '' || isNaN(parseFloat(n.value))) { n.value = r.value; onChange(); } });
      fill(r);
    });
  }

  function val(id) {
    var n = document.getElementById('n-' + id), r = document.getElementById(id);
    var v = n ? parseFloat(n.value) : NaN;
    return isNaN(v) ? parseFloat(r.value) : v;
  }

  function setVal(id, v) {
    var n = document.getElementById('n-' + id), r = document.getElementById(id);
    if (v > +r.max) r.max = v;
    if (v < +r.min) r.min = v;
    r.value = v; if (n) n.value = v; fill(r);
  }

  window.FlamFields = { make: make, val: val, setVal: setVal, fill: fill };
})();
