// X Shadowban Checker - Visit Tracker
(function() {
  // Try to detect backend URL from script src
  var scripts = document.getElementsByTagName("script");
  var scriptUrl = "";
  for (var i = 0; i < scripts.length; i++) {
    var src = scripts[i].src || "";
    if (src.indexOf("tracker.js") !== -1) {
      scriptUrl = src.replace("/tracker.js", "").replace("/tracker", "");
      break;
    }
  }
  var backendUrl = localStorage.getItem("xcheck_backend_url") || scriptUrl || "https://api.xcheckai.online";
  var page = window.location.pathname || "/";
  var ref = document.referrer || "";

  if (navigator.sendBeacon) {
    navigator.sendBeacon(backendUrl + "/api/track",
      JSON.stringify({ page: page, referrer: ref })
    );
  } else {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", backendUrl + "/api/track", true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify({ page: page, referrer: ref }));
  }
})();
