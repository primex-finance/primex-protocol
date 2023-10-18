#!/bin/bash
  
# turn on bash's job control
set -m

ENV_PATH=${ENV_FILE_PATH:-/env/env}

if [ -f "$ENV_PATH" ]
then
    # shellcheck source=/dev/null
    . "${ENV_PATH}"
    {
        grep -v "^#" "${ENV_PATH}" | sed 's/export //'
    } >> .env
else
        echo "'$ENV_PATH' not found, env skipped"
fi

ETH_NET=${ETH_NETWORK:-localhost}

# Run the setup process
if [ -z "${NO_DEPLOY}" ] || ! ${NO_DEPLOY}; then
    if  [ -n "${DEVNODE}" ] && [ "${DEVNODE}" == 2 ]; then
        yarn hardhat deployCoreAndTestnetServices --network devnode2
    elif [ -n "${DEVNODE}" ] && [ "${DEVNODE}" == 3 ]; then
        yarn hardhat deployCoreAndTestnetServices --network devnode3
    else
        yarn hardhat deployCoreAndTestnetServices --network devnode1
        if [ -n "${ETHERNAL_TOKEN}" ]; then
            yarn hardhat syncContractDataWithEthernal --network "$ETH_NET"
        fi
    fi
fi

if [[ -d /data/docgen && -d /data/htmldocs ]]; then
    cp /data/docgen/* /data/htmldocs
fi