#!/usr/bin/with-contenv bashio
bashio::log.info "Starting Roon Web Controller on port 8099"

cd /roon-web-controller

echo "const util = require('util'); util.isRegExp = util.types.isRegExp; util.isDate = util.types.isDate; util.isPromise = util.types.isPromise; util.isArray = Array.isArray;" > patch.js

node -r ./patch.js app.js