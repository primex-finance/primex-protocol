This guideline assumes that you are familiar with the basics of fuzzing testing and how to test with the echidna. If not, you need to familiarize yourself with this https://github.com/crytic/building-secure-contracts/tree/master/program-analysis/echidna#echidna-tutorial tutorial.

There are several testing mode in the Echidna but the assertion mode is the most flexible. Basically we use it. 
All fuzzing test must be created in the "test" folder: `contracts/test`

# E2E Setup
Before starting, make sure you have the latest releases from Echidna and Etheno installed.
Note: This only needs to be done when the target code *changes*.
1. In a terminal, run the following:
```
etheno --ganache --ganache-args "--gasLimit 10000000" -x ./contracts/test/init.json
```
2. In a separate terminal, run the following:
```
yarn hardhat deployFull:fuzzing --network localhost
```
3. Go back to the terminal with Etheno (Step 1) and kill Etheno with `Ctrl+C`. It will save the init.json file.
If your test fails for some reason or you want to run a different one, restart Etheno and re-run the test.

# Run Echidna
```
echidna ./contracts/test/YourTest.sol --contract YourTestContract --config contracts/test/YourTest.yaml
# Tips

1. If the error "Address ... was used during function call from ... to ... but it was never defined as EOA or deployed as a contract" occurs, you need to add that address to the init.json as a AccountCreated event. 
2. If you change the order of transactions or add new ones to the deploy scripts, the addresses of the contracts used in the test may change.
3. Complete and annotated config file with the default options can be found at  https://github.com/crytic/echidna/blob/master/tests/solidity/basic/default.yaml