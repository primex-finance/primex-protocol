const path = require("path");
const fs = require("fs");
const { NATIVE_CURRENCY, USD, USD_DECIMALS, NATIVE_CURRENCY_DECIMALS } = require("../test/utils/constants.js");

const testConfig = {
  isETHNative: true,
};

function getNetworkNameFromHRE() {
  // eslint-disable-next-line no-undef
  return network.name;
}

function setConfig(field, value) {
  const networkName = getNetworkNameFromHRE();
  // for tests
  if (networkName === "hardhat") return;
  const pathToAddressesConfig = path.join(__dirname, networkName, "addresses.json");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(pathToAddressesConfig));
  } catch (e) {
    data = {};
  }

  data[field] = value;

  fs.writeFileSync(pathToAddressesConfig, JSON.stringify(data, null, 2));
}

function checkFolder() {
  const pathToNetworkConfig = path.join(__dirname, getNetworkNameFromHRE());

  fs.stat(pathToNetworkConfig, function (err) {
    if (err && err.code === "ENOENT") {
      fs.mkdir(pathToNetworkConfig, err => {
        if (err) throw err;
      });
    }
  });
}

function getConfigByName(configName) {
  let config;
  try {
    const pathToConfig = path.join(__dirname, getNetworkNameFromHRE(), configName);
    config = JSON.parse(fs.readFileSync(pathToConfig));
  } catch {
    const defaultConfig = path.join(__dirname, "devnode1", configName);
    config = JSON.parse(fs.readFileSync(defaultConfig));
  }
  return config;
}

function getConfig(field = undefined) {
  const networkName = getNetworkNameFromHRE();
  // for tests
  if (networkName === "hardhat") return testConfig;

  const pathToAddressesConfig = path.join(__dirname, networkName, "addresses.json");
  let addresses;

  try {
    addresses = JSON.parse(fs.readFileSync(pathToAddressesConfig));
  } catch (e) {
    console.log(`ERROR: failed to read file: file path [${pathToAddressesConfig}], error [${e}]`);
    return {};
  }

  if (field === undefined) {
    return addresses;
  } else {
    if (addresses[field] === undefined) addresses[field] = {};
    return addresses[field];
  }
}

async function getAddress(object) {
  let address;
  if (object.address !== undefined) {
    address = object.address;
  } else if (object.contract !== undefined) {
    const { assets } = getConfig();
    if (assets?.[object.contract] !== undefined) return assets[object.contract];
    if (object.contract === "usd") return USD;
    if (object.contract === "native") return NATIVE_CURRENCY;

    // eslint-disable-next-line no-undef
    address = (await ethers.getContract(object.contract)).address;
  }
  return address;
}

async function getDecimals(address) {
  if (address === USD) return USD_DECIMALS;
  if (address === NATIVE_CURRENCY) return NATIVE_CURRENCY_DECIMALS;
  // eslint-disable-next-line no-undef
  return await (await ethers.getContractAt("ERC20", address)).decimals();
}
module.exports = { setConfig, getConfigByName, getConfig, checkFolder, getAddress, getDecimals };
