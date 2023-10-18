FROM node:18.13.0-bullseye-slim
ARG SSH_KEY

RUN  apt update && apt install --yes libsecret-1-dev netcat git make gcc g++
RUN mkdir -p /root/.ssh && \
    chmod 0700 /root/.ssh && \
    ssh-keyscan github.com > /root/.ssh/known_hosts && \
    echo "${SSH_KEY}" > /root/.ssh/id_rsa && \
    chmod 600 /root/.ssh/id_rsa
WORKDIR /data
COPY ./src ./
RUN yarn install
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
CMD [ "/docker-entrypoint.sh" ]
