#!/usr/bin/with-contenv bashio
bashio::log.info "Starting Roon Web Controller on port 8099"

cd /roon-web-controller

node app.js