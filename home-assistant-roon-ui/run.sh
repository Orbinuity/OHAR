#!/usr/bin/with-contenv bashio
bashio::log.info "Starting Roon Web UI on port 8099"

cd /RoonWebUI

if bashio::config.true 'verbose_logging'; then
    bashio::log.info "Verbose logging is enabled (-v flag added)"
    node app.js -p 8099 -v
else
    node app.js -p 8099
fi