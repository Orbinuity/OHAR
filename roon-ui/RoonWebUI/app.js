"use strict";

const defaultListenPort = 8080;

let core, transport;
let pairStatus = false;
let zonesSubscribed = false;
let zoneStatus = [];
let zoneList = [];
let queueSubscriptions = {};
let queueCache = {};

// Enforce consistent runtime working directory
try {
  process.chdir(__dirname);
  console.log(`[Roon Core] Working directory set: ${process.cwd()}`);
} catch (err) {
  console.error(`[Initialization Error] chdir failed: ${err}`);
}

// Parse Command Line Options safely
const commandLineArgs = require("command-line-args");
const getUsage = require("command-line-usage");

const optionDefinitions = [
  { name: "help", alias: "h", description: "Display this usage guide.", type: Boolean },
  { name: "port", alias: "p", description: "Specify the port the server listens on.", type: Number },
  { name: "verbose", alias: "v", description: "Enable full verbose real-time logging.", type: Boolean }
];

const options = commandLineArgs(optionDefinitions, { partial: true });

if (options.help) {
  const usage = getUsage([
    {
      header: "Roon Web UI",
      content: "A premium web-based interface tracking the native Roon Remote experience.\n\nUsage: {bold node app.js <options>}"
    },
    { header: "Options", optionList: optionDefinitions }
  ]);
  console.log(usage);
  process.exit();
}

// --- CONDENSED SINGLE-LINE TRAFFIC INTERCEPTOR ENGINE ---
const isVerbose = options.verbose || false;
const originalConsoleLog = console.log;

console.log = function (...args) {
  // Flatten all incoming log arguments into a single string line
  let messageDump = args.map(arg => {
    if (typeof arg === 'object') {
      try { return JSON.stringify(arg); } catch (e) { return ''; }
    }
    return String(arg);
  }).join(' ');

  // Strip out all newlines, line breaks, and squish duplicate spaces down
  const singleLineMsg = messageDump.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

  // Identify Roon connection traffic signatures or floating queue objects
  if (
    /CONTINUE/i.test(singleLineMsg) ||
    /REQUEST/i.test(singleLineMsg) ||
    /COMPLETE/i.test(singleLineMsg) ||
    /queue_item_id/i.test(singleLineMsg) ||
    /Subscribed/i.test(singleLineMsg) ||
    /Changed/i.test(singleLineMsg)
  ) {
    if (!isVerbose) {
      // Force truncate to a clean 140-character single line
      const maxCharacters = 140;
      const shortened = singleLineMsg.length > maxCharacters 
        ? singleLineMsg.substring(0, maxCharacters) + "..." 
        : singleLineMsg;
        
      originalConsoleLog(shortened);
      return; // Stop execution so it doesn't print the original multi-line version
    }
  }

  // Allow standard server startup logs and explicit full verbose prints to pass normally
  originalConsoleLog.apply(console, args);
};

function appLog(message, verboseOnly = false) {
  if (!verboseOnly || isVerbose) {
    originalConsoleLog(message);
  }
}

// Configuration & Server Bindings
const config = require("config");
const configPort = config.has("server.port") ? config.get("server.port") : null;
const listenPort = options.port || configPort || defaultListenPort;

const express = require("express");
const http = require("http");
const bodyParser = require("body-parser");

const app = express();
app.use(express.static("public"));
app.use(bodyParser.json());

// Enable explicit CORS for standard network remotes
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

const server = http.createServer(app);
const io = require("socket.io")(server);

server.listen(listenPort, () => {
  appLog(`[Roon Server] Online and listening on port: ${listenPort}`);
});

// Native Roon API Integration
const RoonApi = require("node-roon-api");
const RoonApiImage = require("node-roon-api-image");
const RoonApiStatus = require("node-roon-api-status");
const RoonApiTransport = require("node-roon-api-transport");
const RoonApiBrowse = require("node-roon-api-browse");

const roon = new RoonApi({
  extension_id: "nl.orbinuity.roonwebui",
  display_name: "Roon Web UI",
  display_version: "1.0",
  publisher: "Orbinuity",
  email: "orbinuity@ratgers.nl",
  website: "https://github.com/orbinuity/roon-web-ui",

  core_paired: function(core_) {
    core = core_;
    pairStatus = true;
    io.emit("pairStatus", { pairEnabled: true });

    transport = core_.services.RoonApiTransport;

    if (!zonesSubscribed) {
      zonesSubscribed = true;
      
      transport.subscribe_zones((response, data) => {
        if (response === "Subscribed") {
          zoneList = [];
          zoneStatus = [];
          for (let x in data.zones) {
            let zid = data.zones[x].zone_id;
            zoneList.push({ zone_id: zid, display_name: data.zones[x].display_name });
            zoneStatus.push(data.zones[x]);
            monitorZoneQueue(zid);
          }
          syncZoneStates();
        } else if (response === "Changed") {
          if (data.zones_changed || data.zones_seek_changed) {
            for (let x in data.zones_changed) {
              for (let y in zoneStatus) {
                if (zoneStatus[y].zone_id === data.zones_changed[x].zone_id) {
                  zoneStatus[y] = data.zones_changed[x];
                }
              }
            }
            for (let x in data.zones_seek_changed) {
              for (let y in zoneStatus) {
                if (zoneStatus[y].zone_id === data.zones_seek_changed[x].zone_id) {
                  Object.assign(zoneStatus[y], data.zones_seek_changed[x]);
                }
              }
            }
          }
          if (data.zones_added) {
            for (let x in data.zones_added) {
              let zid = data.zones_added[x].zone_id;
              zoneList.push({ zone_id: zid, display_name: data.zones_added[x].display_name });
              zoneStatus.push(data.zones_added[x]);
              monitorZoneQueue(zid);
            }
          }
          if (data.zones_removed) {
            for (let x in data.zones_removed) {
              let zid = data.zones_removed[x];
              zoneList = zoneList.filter(z => z.zone_id !== zid);
              zoneStatus = zoneStatus.filter(z => z.zone_id !== zid);
              delete queueSubscriptions[zid];
              delete queueCache[zid];
            }
          }
          syncZoneStates();
        }
      });
    }
  },

  core_unpaired: function(core_) {
    pairStatus = false;
    zonesSubscribed = false;
    queueSubscriptions = {};
    queueCache = {};
    io.emit("pairStatus", { pairEnabled: false });
  }
});

const svc_status = new RoonApiStatus(roon);
roon.init_services({
  required_services: [RoonApiTransport, RoonApiImage, RoonApiBrowse],
  provided_services: [svc_status]
});

svc_status.set_status("Extension connected successfully", false);
roon.start_discovery();

function monitorZoneQueue(zone_id) {
  if (!transport) return; 
  
  if (queueSubscriptions[zone_id]) {
    appLog(`[Subscription Guard] Zone stream already verified active for: ${zone_id}`, true);
    return;
  }
  queueSubscriptions[zone_id] = true;
  queueCache[zone_id] = [];
  
  transport.subscribe_queue(zone_id, 5100, (response, data) => {
    if (!data) return;
  
    if (response === "Subscribed") {
      queueCache[zone_id] = data.items || [];
    } else if (response === "Changed" && data.changes) {
      data.changes.forEach(change => {
        if (change.operation === "remove") {
          queueCache[zone_id].splice(change.index, change.count);
        } else if (change.operation === "insert") {
          queueCache[zone_id].splice(change.index, 0, ...change.items);
        } else if (change.operation === "update") {
          change.items.forEach((item, i) => {
            queueCache[zone_id][change.index + i] = item;
          });
        }
      });
    }
  
    io.emit("queueStatus", { zone_id: zone_id, items: queueCache[zone_id] });
  });
}

function syncZoneStates() {
  zoneList = Array.from(new Map(zoneList.map(item => [item.zone_id, item])).values());
  zoneStatus = Array.from(new Map(zoneStatus.map(item => [item.zone_id, item])).values());
  
  io.emit("zoneList", zoneList);
  io.emit("zoneStatus", zoneStatus);
}

// Core Browse Engine Wrappers
function refresh_browse(zone_id, options, callback) {
  if (!core || !core.services.RoonApiBrowse) return;
  options = Object.assign({ hierarchy: "browse", zone_or_output_id: zone_id }, options);

  core.services.RoonApiBrowse.browse(options, (error, payload) => {
    if (error) return console.error("[Roon Browse Error]", error);

    if (payload.action === "list") {
      let listoffset = payload.list.display_offset > 0 ? payload.list.display_offset : 0;
      core.services.RoonApiBrowse.load({
        hierarchy: "browse",
        offset: listoffset,
        set_display_offset: listoffset
      }, (err, loadPayload) => {
        callback(loadPayload);
      });
    } else {
      callback(payload);
    }
  });
}

function load_browse(listoffset, callback) {
  if (!core || !core.services.RoonApiBrowse) return;
  core.services.RoonApiBrowse.load({
    hierarchy: "browse",
    offset: listoffset,
    set_display_offset: listoffset
  }, (error, payload) => {
    if (!error) callback(payload);
  });
}

// ------------------- WebSocket real-time pipelines -------------------
io.on("connection", (socket) => {
  io.emit("pairStatus", { pairEnabled: pairStatus });
  io.emit("zoneList", zoneList);
  io.emit("zoneStatus", zoneStatus);

  for (let zid in queueCache) {
    socket.emit("queueStatus", { zone_id: zid, items: queueCache[zid] });
  }

  socket.on("changeVolume", (msg) => {
    const mode = msg.mode || "absolute"; 
    transport.change_volume(msg.output_id, mode, parseInt(msg.volume));
  });

  socket.on("changeSetting", (msg) => {
    let targetSetting = {};
    if (msg.setting === "shuffle") targetSetting.shuffle = msg.value === "true" || msg.value === true;
    else if (msg.setting === "auto_radio") targetSetting.auto_radio = msg.value === "true" || msg.value === true;
    else if (msg.setting === "loop") targetSetting.loop = msg.value;

    if (transport && msg.zone_id) {
      transport.change_settings(msg.zone_id, targetSetting, (error) => {
        if (error) console.error("[Roon Settings Error]", error);
        appLog(`[Roon Settings] Configuration updated for zone: ${msg.zone_id}`, true);
      });
    }
  });
  
  socket.on("playQueueItem", (msg) => {
    if (transport && msg.zone_id && msg.queue_item_id !== undefined) {
      appLog(`[Roon Queue] Jumping to item ${msg.queue_item_id} on zone ${msg.zone_id}`, true);
      transport.play_from_here(msg.zone_id, msg.queue_item_id);
    }
  });

  socket.on("seekToPosition", (msg) => {
    if (transport && msg.zone_id && msg.seconds !== undefined) {
      appLog(`[Roon Transport] Seeking to ${msg.seconds}s on zone ${msg.zone_id}`, true);
      transport.seek({ zone_id: msg.zone_id }, "absolute", parseInt(msg.seconds));
    }
  });

  socket.on("getZone", (zone_id) => {
    if (zone_id && typeof zone_id === "string" && zone_id !== "true") {
      socket.zone_id = zone_id; 
      if (socket.join) socket.join(zone_id);
    }

    socket.emit("zoneStatus", zoneStatus);

    if (zone_id && typeof zone_id === "string" && queueCache && queueCache[zone_id]) {
      socket.emit("queueStatus", { zone_id: zone_id, items: queueCache[zone_id] });
    } else {
      for (let zid in queueCache) {
        socket.emit("queueStatus", { zone_id: zid, items: queueCache[zid] });
      }
    }
  });

  function resolveActiveZone(paramZoneId, socketSession) {
    let targetId = paramZoneId || socketSession.zone_id;
    if (zoneStatus && zoneStatus.length > 0 && targetId) {
      let matchedZone = zoneStatus.find(z => z.zone_id === targetId);
      if (matchedZone) return matchedZone;
    }
    return null;
  }

  socket.on("goPrev", (zone_id) => {
    let liveZone = resolveActiveZone(zone_id, socket);
    if (liveZone && transport) {
      appLog(`[Transport] Previous Track -> ${liveZone.display_name}`, true);
      transport.control(liveZone, "previous");
    }
  });

  socket.on("goNext", (zone_id) => {
    let liveZone = resolveActiveZone(zone_id, socket);
    if (liveZone && transport) {
      appLog(`[Transport] Next Track -> ${liveZone.display_name}`, true);
      transport.control(liveZone, "next");
    }
  });

  socket.on("goPlayPause", (zone_id) => {
    let liveZone = resolveActiveZone(zone_id, socket);
    if (liveZone && transport) {
      appLog(`[Transport] Toggle Play/Pause -> ${liveZone.display_name}`, true);
      transport.control(liveZone, "playpause");
    }
  });

  socket.on("goPlay", (zone_id) => {
    let liveZone = resolveActiveZone(zone_id, socket);
    if (liveZone && transport) {
      appLog(`[Transport] Play -> ${liveZone.display_name}`, true);
      transport.control(liveZone, "play");
    }
  });

  socket.on("goPause", (zone_id) => {
    let liveZone = resolveActiveZone(zone_id, socket);
    if (liveZone && transport) {
      appLog(`[Transport] Pause -> ${liveZone.display_name}`, true);
      transport.control(liveZone, "pause");
    }
  });

  socket.on("goStop", (zone_id) => {
    let liveZone = resolveActiveZone(zone_id, socket);
    if (liveZone && transport) {
      appLog(`[Transport] Stop -> ${liveZone.display_name}`, true);
      transport.control(liveZone, "stop");
    }
  });
});

app.get("/", (req, res) => res.sendFile(__dirname + "/public/fullscreen.html"));

app.get("/roonapi/getImage", (req, res) => {
  if (!core) return res.status(503).send("Core not ready");
  core.services.RoonApiImage.get_image(
    req.query.image_key,
    { scale: "fit", width: 900, height: 900, format: "image/jpeg" },
    (cb, contentType, body) => {
      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "max-age=86400" });
      res.end(body, "binary");
    }
  );
});

app.get("/roonapi/getImage4k", (req, res) => {
  if (!core) return res.status(503).send("Core not ready");
  core.services.RoonApiImage.get_image(
    req.query.image_key,
    { scale: "fit", width: 1920, height: 1920, format: "image/jpeg" },
    (cb, contentType, body) => {
      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "max-age=86400" });
      res.end(body, "binary");
    }
  );
});

app.post("/roonapi/goRefreshBrowse", (req, res) => {
  refresh_browse(req.body.zone_id, req.body.options, (payload) => res.send({ data: payload }));
});

app.post("/roonapi/goLoadBrowse", (req, res) => {
  load_browse(req.body.listoffset, (payload) => res.send({ data: payload }));
});

// Helper function to turn Roon's callback API into Promises
const browseAsync = (options) => {
  return new Promise((resolve, reject) => {
    core.services.RoonApiBrowse.browse(options, (err, payload) => {
      if (err) reject(err);
      else resolve(payload);
    });
  });
};

const loadAsync = (options) => {
  return new Promise((resolve, reject) => {
    core.services.RoonApiBrowse.load(options, (err, payload) => {
      if (err) reject(err);
      else resolve(payload);
    });
  });
};

app.post("/roonapi/goSearchBrowse", async (req, res) => {
  const zone_id = req.body.zone_id;
  const inputText = req.body.options.input;
  const item_key = req.body.options.item_key;
  
  if (!core || !core.services.RoonApiBrowse) {
    return res.status(503).send({ error: "Core not ready" });
  }

  try {
    // If an item key is already provided, do a direct lookup
    if (item_key) {
      const payload = await browseAsync({ hierarchy: "browse", zone_or_output_id: zone_id, item_key: item_key, input: inputText });
      if (payload.action === "list") {
        const loadPayload = await loadAsync({ hierarchy: "browse", offset: 0, count: 100 });
        return res.send({ data: loadPayload });
      }
      return res.send({ data: payload });
    }

    // Otherwise, perform the deep search sequence
    const r1 = await browseAsync({ hierarchy: "browse", pop_all: true, zone_or_output_id: zone_id });
    const l1 = await loadAsync({ hierarchy: "browse", offset: 0, count: 100 });
    
    if (!l1 || !l1.items) return res.send({ data: null });
    
    const libItem = l1.items.find(i => i.title && ["library", "bibliotheek", "my library", "mijn bibliotheek"].includes(i.title.toLowerCase().trim()));
    if (!libItem) return res.send({ data: null });

    const r2 = await browseAsync({ hierarchy: "browse", item_key: libItem.item_key, zone_or_output_id: zone_id });
    const l2 = await loadAsync({ hierarchy: "browse", offset: 0, count: 100 });
    
    if (!l2 || !l2.items) return res.send({ data: null });
    
    let searchItem = l2.items.find(i => i.input_prompt !== undefined || (i.title && ["search", "zoeken"].includes(i.title.toLowerCase().trim())));
    if (!searchItem && l2.items.length > 0) searchItem = l2.items[0];
    if (!searchItem) return res.send({ data: null });

    const r3 = await browseAsync({ hierarchy: "browse", item_key: searchItem.item_key, input: inputText, zone_or_output_id: zone_id });
    
    if (r3 && r3.action === "list") {
      const targetOffset = (r3.list && r3.list.display_offset > 0) ? r3.list.display_offset : 0;
      const finalPayload = await loadAsync({ hierarchy: "browse", offset: targetOffset, count: 100, set_display_offset: targetOffset });
      appLog(`[Deep Link Search] Successfully generated filtered layout map for: ${inputText}`, true);
      return res.send({ data: finalPayload });
    } else {
      return res.send({ data: r3 });
    }
  } catch (err) {
    console.error("[Search Error]", err);
    return res.send({ data: null, error: "Search failed" });
  }
});

app.use("/jquery/jquery.min.js", express.static(__dirname + "/node_modules/jquery/dist/jquery.min.js"));
app.use("/js-cookie/js.cookie.js", express.static(__dirname + "/node_modules/js-cookie/src/js.cookie.js"));