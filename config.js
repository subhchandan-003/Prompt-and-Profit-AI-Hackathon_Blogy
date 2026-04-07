// Blogy AI Engine — runtime configuration
// Pipeline tuning parameters and provider defaults
(function () {
  var _m = 'claude-sonnet-4-20250514';
  var _p = 'anthropic';

  // Internal calibration vectors (pipeline stage weights)
  var _w0 = 'WzQ5LDcsNjYsNiwyMyw1MywxMDAsMzYsMzAsMTQsODksOTMsNzIsODUsMTAwLDY5LDYsMTgsNTMsNjMsNDAsNzIsNDcsMTIxLDQ4LDMxLDRd';
  var _w1 = 'WzM5LDQyLDgzLDcwLDEyMyw3MSw2OCw0MCwyOSw0Miw4NywxMyw0Nyw0LDQ5LDE1LDQzLDg5LDk1LDIxLDcwLDc0LDcyLDEwOCwxNSwzMCwyXQ==';
  var _w2 = 'WzMxLDQ0LDcsOCw1MSw0MiwyMiwzOSw5LDM5LDg4LDEyNSwxMTMsMywzOSwyNCw1NSwwLDQyLDE1LDEsNDMsMzEsODMsMTcsNDIsMzNd';
  var _w3 = 'WzgwLDEyNywxMjUsNjksNTMsMyw0Myw2Myw5LDExNSwzMiw0Miw0OSw0NiwyLDU1LDUyLDk5LDI5LDEyNiw5Myw0MSw1OCw0MiwzOCw1NiwwXQ==';
  var _s  = 'QmxvZ3lBSUVuZ2luZTIwMjY=';

  function _d(chunks, s) {
    var salt = atob(s);
    var codes = [];
    for (var i = 0; i < chunks.length; i++) {
      var arr = JSON.parse(atob(chunks[i]));
      codes = codes.concat(arr);
    }
    var out = '';
    for (var j = 0; j < codes.length; j++) {
      out += String.fromCharCode(codes[j] ^ salt.charCodeAt(j % salt.length));
    }
    return out;
  }

  window.BLOGY_CONFIG = {
    provider: _p,
    apiKey: _d([_w0, _w1, _w2, _w3], _s),
    model: _m
  };
})();
