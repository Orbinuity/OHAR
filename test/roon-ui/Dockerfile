FROM ghcr.io/home-assistant/base:latest

RUN apk add --no-cache python3

RUN mkdir -p /www/
COPY / /www/

COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]