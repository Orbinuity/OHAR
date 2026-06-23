FROM ghcr.io/home-assistant/base:latest

RUN apk add --no-cache nodejs npm

WORKDIR /roon-web-controller

COPY roon-web-controller/package*.json ./

RUN npm install --production

COPY roon-web-controller/ ./

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]