// SPDX-License-Identifier: BUSL-1.1
const path = require("path");
const fs = require("fs");

module.exports = async function (
  { bucketMode },
  {
    network,
    ethers: {
      getContract,
      getContractAt,
      constants: { HashZero },
      provider,
      utils: { hexlify, id },
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { getConfig } = require("../../config/configUtils.js");
  const { assets } = getConfig();
  const chainId = (await provider.getNetwork()).chainId;
  // This script creates a proposals for each of the assets listed in the `assetsToAdd` to all buckets that exist in bucketAddresses
  // Please add the addresses of existing buckets where you want to add the new asset
  // arbitrum
  /*
  "0x653a3Bc43BD7B44Ab875F56cC0db54865a48CB2B",
  "0x2Fa0BA6d651B2306FBcB22797Db0409BcF795F69",
  "0xC1C334AE711db9b83D03eC7C3a413D38b01826c5",
  "0x018b221753Ef25Da38e672e0D3747bD626ae2e71",
  "0xe58b8b7435477a42c13c327166370de16d0Df313"  
  */

  // polygon
  /*
  "0x12c125181Eb7c944EaEfcB2AE881475870f0Aff3", 
  "0x76e7759445BB8028f725e8E795DadeE8b209f6Ac",
  "0x6dd0028bA6945Ee5B859D3C7fe89bCdec57B67Af",
  "0x0e28A9D0BEd228981feC47b203611422717f9593",
  "0x269010DBFFea6C388676de7ec340Af3c20a2951a",
    "0xEFD28D2B9ba8c6860f71B0334eFc1e9fB07552C0",
    "0x6956BdfF17C68D3B37faF1415769De316682EDBb",
    "0x0bF4003de65eCeA86026c6Cdcc80eb6Bfa15A3A7",
    "0xAa5f11e1C14F9a73467Bf79972585c5df1842104",
    "0xFD69831f0bbc4EF20A5cf493Ba8AAcB924A7CDFC",
    "0x7e9144D94bB57F18C20381d0b234e9B3bb4437e3",
    "0x8104F1457f6B6cD34A1E58505F3d0B8E01430cFf",
    "0xc5F1A9d54652fD04Bf9a688273966a81814acB8b",
    "0xdE25839A447B75Dece3842F18A535bA4cC4d2E69",
    "0x89A13D39909bCEa5A85EC8e4fb49551e8ACFf56B",
    "0xdD183B7b2B0B1276f3983829894bbcF2d5FA47A4",
    "0xd11E60d61d0F0e9e2c0B00B8344082212a5436Cf",
    "0x3edb777e8Af4d2C83f45cFDb338E9C2ee29b6c1F",
    "0x8A0c95f3E245887D313C76e0C22242E39D88373e",
    "0xBB9Fa95A393056cE2d5Df22E61295f2110D526F4",
    "0x9333a0152F63e68f532dC27001706E4501444Ffb",
    "0x7f92bBC5D6eBA6E6EF715dDC2Ef74d0FC4582F76",
    "0x628C0b15eB945b03B198983177eb1D94d7Dbfa0A",
    "0x7248f3Ce52C941F010751F496fbb79b8940ff6ea",
    "0xBf998955A4907c55765230186D261334D9aBcd47",
    "0x6416A56634579403178B99c13fb729b19306d477",
    "0x61790eec36DF6b9ad38047d771001B765d83b5b1",
    "0x4Def744D8bfa687a98D3568bADe26a20ADa55Ee4",
    "0xf860306566CEaF32D669BE0593abd69F5fE50Ca8",
    "0x732d72585b5047c67c1929044282cBacD9Fc8451",
    "0x101Da436Dd6f3Ea0E002f92CD2cAb99f6D21fEad",
    "0x177Dbc14fB0Dd0fC077aFED681c86d0c34E1afe3",
  */

  const bucketAddresses = [
    "0x6956BdfF17C68D3B37faF1415769De316682EDBb",
    "0x0bF4003de65eCeA86026c6Cdcc80eb6Bfa15A3A7",
    "0xAa5f11e1C14F9a73467Bf79972585c5df1842104",
    "0xFD69831f0bbc4EF20A5cf493Ba8AAcB924A7CDFC",
    "0x7e9144D94bB57F18C20381d0b234e9B3bb4437e3",
    "0x8104F1457f6B6cD34A1E58505F3d0B8E01430cFf",
    "0xc5F1A9d54652fD04Bf9a688273966a81814acB8b",
    "0xdE25839A447B75Dece3842F18A535bA4cC4d2E69",
    "0x89A13D39909bCEa5A85EC8e4fb49551e8ACFf56B",
    "0xdD183B7b2B0B1276f3983829894bbcF2d5FA47A4",
    "0xd11E60d61d0F0e9e2c0B00B8344082212a5436Cf",
    "0x3edb777e8Af4d2C83f45cFDb338E9C2ee29b6c1F",
    "0x8A0c95f3E245887D313C76e0C22242E39D88373e",
    "0xBB9Fa95A393056cE2d5Df22E61295f2110D526F4",
    "0x9333a0152F63e68f532dC27001706E4501444Ffb",
    "0x7f92bBC5D6eBA6E6EF715dDC2Ef74d0FC4582F76",
    "0x628C0b15eB945b03B198983177eb1D94d7Dbfa0A",
    "0x7248f3Ce52C941F010751F496fbb79b8940ff6ea",
    "0xBf998955A4907c55765230186D261334D9aBcd47",
    "0x6416A56634579403178B99c13fb729b19306d477",
    "0x61790eec36DF6b9ad38047d771001B765d83b5b1",
    "0x4Def744D8bfa687a98D3568bADe26a20ADa55Ee4",
    "0xf860306566CEaF32D669BE0593abd69F5fE50Ca8",
    "0x732d72585b5047c67c1929044282cBacD9Fc8451",
    "0x101Da436Dd6f3Ea0E002f92CD2cAb99f6D21fEad",
    "0x177Dbc14fB0Dd0fC077aFED681c86d0c34E1afe3",
  ];

  // Add actual assets which will be added to buckets and their addresses will be taken from config file addresses.json
  const assetsToAdd = ["usdc", "usdt", "usdc.e", "wmatic", "weth", "wbtc"];

  // polygon
  // "crv", "dai", "wfil", "dodo", "ageur", "yfi", "cel", "ftm", "om", "sand", "ape", "quick", "mana", "1inch", "bal", "comp", "sol", "axs", "grt", "paxg", "snx", "frax", "cvx", "bat", "ghst", "uma", "tusd", "avax", "knc", "woo", "fxs", "sushi"
  // arbitrum
  // "weth", "usdc", "usdc.e", "wbtc", "usdt"
  // "pepe", "spell", "dodo", "grt", "woo", "crv", "knc", "xai", "tusd", "bal", "fxs", "tia", "rpl", "comp", "yfi", "cake", "aave", "uni", "sushi", "ldo", "joe", "dai"
  // "axl", "frax", "usdd"

  // immutable
  const SmallTimeLock = await getContract("SmallTimelockAdmin");

  const smallDelay = await SmallTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const output = {};
  if (!bucketMode) {
    for (const assetName of assetsToAdd) {
      if (!(assetName in assets)) {
        console.log(`Asset ${assetName} not found in addresses.json. Skipping...`);
        continue;
      }
      if (!output[assetName]) {
        output[assetName] = {};
      }
      const assetAddress = assets[assetName];
      const targets = [];
      const payloads = [];
      // List of interface IDs to check
      for (const bucketAddress of bucketAddresses) {
        const Bucket = await getContractAt("Bucket", bucketAddress);
        const encodeResult = await encodeFunctionData("addAsset", [assetAddress], "Bucket", Bucket.address);
        targets.push(encodeResult.contractAddress);
        payloads.push(encodeResult.payload);
      }
      console.log(`Proposal created for ${assetName}`);
      output[assetName] = [targets, Array(targets.length).fill(0), payloads, predecessor, salt, smallDelay.toString()];
    }
  } else {
    for (const bucketAddress of bucketAddresses) {
      if (!output[bucketAddress]) {
        output[bucketAddress] = {};
      }

      const targets = [];
      const payloads = [];
      const Bucket = await getContractAt("Bucket", bucketAddress);

      for (const assetName of assetsToAdd) {
        if (!(assetName in assets)) {
          console.log(`Asset ${assetName} not found in addresses.json. Skipping...`);
          continue;
        }
        const assetAddress = assets[assetName];
        const encodeResult = await encodeFunctionData("addAsset", [assetAddress], "Bucket", Bucket.address);
        targets.push(encodeResult.contractAddress);
        payloads.push(encodeResult.payload);
      }
      console.log(`Proposal created for ${Bucket.address}`);
      output[bucketAddress] = [targets, Array(targets.length).fill(0), payloads, predecessor, salt, smallDelay.toString()];
    }
  }

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "AddNewAssetsToBuckets");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });

  fs.writeFileSync(path.join(directoryPath, "AddAssetsToBuckets_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleBatchData = await prepareScheduleBatchData(output);
  const executeBatchData = await prepareExecuteBatchData(output);

  fs.writeFileSync(path.join(directoryPath, "AddAssetsToBuckets_create.json"), JSON.stringify(scheduleBatchData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "AddAssetsToBuckets_execute.json"), JSON.stringify(executeBatchData, null, 2));

  async function prepareScheduleBatchData(output) {
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Multiple Batch Schedule Transaction",
        description: "Multiple SmallTimelockAdmin.scheduleBatch to add new assets to buckets",
      },
      transactions: [],
    };
    for (const asset in output) {
      const data = output[asset];
      const [targets, values, payloads] = data;

      const encodeResult = await encodeFunctionData(
        "scheduleBatch",
        [targets, values, payloads, predecessor, salt, smallDelay],
        "SmallTimelockAdmin",
      );

      scheduleData.transactions.push({
        to: encodeResult.contractAddress,
        value: "0",
        data: encodeResult.payload,
        contractMethod: null,
        contractInputsValues: null,
      });
    }
    return scheduleData;
  }

  async function prepareExecuteBatchData(output) {
    const executeData = {
      chainId: chainId,
      meta: {
        name: "Multiple Batch Execute Transaction",
        description: "Multiple SmallTimelockAdmin.executeBatch to add new assets to buckets",
      },
      transactions: [],
    };
    for (const asset in output) {
      const data = output[asset];
      const [targets, values, payloads] = data;

      const encodeResult = await encodeFunctionData("executeBatch", [targets, values, payloads, predecessor, salt], "SmallTimelockAdmin");

      executeData.transactions.push({
        to: encodeResult.contractAddress,
        value: "0",
        data: encodeResult.payload,
        contractMethod: null,
        contractInputsValues: null,
      });
    }
    return executeData;
  }
};
