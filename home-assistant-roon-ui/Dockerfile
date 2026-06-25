FROM ghcr.io/home-assistant/base:latest

RUN cp /etc/apk/repositories /etc/apk/repositories.bak && \
    echo "http://dl-cdn.alpinelinux.org/alpine/v3.19/main" > /etc/apk/repositories && \
    echo "http://dl-cdn.alpinelinux.org/alpine/v3.19/community" >> /etc/apk/repositories && \
    apk update && \
    apk add --no-cache nodejs npm && \
    mv /etc/apk/repositories.bak /etc/apk/repositories

WORKDIR /RoonWebUI

COPY RoonWebUI/package*.json ./

RUN npm install --production

COPY RoonWebUI/ ./

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]