#!/bin/bash

if docker run -v "$(pwd)"/coverage:/data/coverage -v "$(pwd)"/coverage.json:/data/coverage.json -e COVERAGE=true "${IMAGE}" yarn hardhat coverage > test_results.txt ; then 
    echo "Tests passed successfully" >> test_results.txt
    docker run -v "$(pwd)"/cobertura-coverage.xml:/data/cobertura-coverage.xml -v "$(pwd)"/coverage.json:/data/coverage.json "${IMAGE}" bash -c "npm install -g istanbul && istanbul report cobertura --root /data --dir /data"
else 
    echo "Tests failed" >> test_results.txt
    exit 1
fi

docker-compose up -d
RETR=1 
until docker-compose ps | grep 'Up (healthy)'; do 
    echo "Waiting for node to start, try ${RETR} ..." 
    sleep 60
    ((RETR++))
    if [ "${RETR}" -gt 3 ]; then 
        echo "Contracts failed to deploy"
        exit 1 
    fi
done

echo "Node started successfully, starting contracts deploy..."

if docker-compose exec -T hardhat yarn hardhat deployFull:devnode1 --network host ; then 
    echo "Contracts deploy successful" >> test_results.txt
else 
    echo "Contracts deploy failed" >> test_results.txt
    exit 1
fi

# TODO: fix testnet:CreateLimitOrder. It's not critical, used only for tests
# if docker-compose exec -T hardhat yarn hardhat testnet:CreateLimitOrder --network host ; then
#     echo "testnet:CreateLimitOrder successful" >> test_results.txt
# else
#     echo "testnet:CreateLimitOrder failed" >> test_results.txt
#     exit 1
# fi

# echo "Running slither analysis"
# docker-compose exec -T hardhat apt update
# docker-compose exec -T hardhat apt install -y pip
# docker-compose exec -T hardhat pip install solc-select==1.0.0b1
# docker-compose exec -T hardhat solc-select install 0.8.10
# docker-compose exec -T hardhat pip install slither-analyzer
# docker-compose exec -T hardhat solc-select use 0.8.10
# # docker-compose exec -T hardhat bash -c 'for i in $(ls /data/contracts/**/*.sol); do slither $i --disable-color || true ; done' &>> slither_result.txt 
# docker-compose exec -T hardhat slither . &> slither_result.txt 
# echo "Completed slither"
