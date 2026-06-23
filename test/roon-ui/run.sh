#!/usr/bin/with-contenv bashio
bashio::log.info "Starting Roon UI webserver on port 8099..."

cd /www

python3 -m http.server 8099