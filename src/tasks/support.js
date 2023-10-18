const fs = require("fs");

const { utils, Wallet, Contract } = require("zksync-web3");
const { Deployer } = require("@matterlabs/hardhat-zksync-deploy");
const PRIVATE_KEY = process.env.PRIVATE_KEY;

async function deployContract({ contractName, artifactName = contractName, args = [] }, hre) {
  if (hre.network.config.zksync) {
    const wallet = new Wallet(PRIVATE_KEY);
    const deployer = new Deployer(hre, wallet);
    fs.stat(`./deployments/${hre.network.name}`, function (err) {
      if (!err) return;
      if (err.code === "ENOENT") {
        fs.mkdir(`./deployments/${hre.network.name}`, { recursive: true }, function () {});
      }
    });

    fs.stat(`./deployments/${hre.network.name}/.chainId`, async function (err) {
      if (err) {
        const chainId = (await deployer.zkWallet.provider.getNetwork()).chainId;
        await fs.writeFileSync(`./deployments/${hre.network.name}/.chainId`, `${chainId}`);
      }
    });

    const artifact = await deployer.loadArtifact(contractName);

    const contract = await deployer.deploy(artifact, args, { feeToken: process.env.FEE_TOKEN || utils.ETH_ADDRESS });

    process.stdout.write(`deploying "${artifactName}" (tx: ${contract.deployTransaction.hash})...: `);
    const txReceipt = await contract.deployTransaction.wait();
    console.log(`deployed at ${contract.address}`);

    const data = JSON.stringify({
      address: contract.address,
      abi: artifact.abi,
      receipt: txReceipt,
    });
    await fs.writeFileSync(`./deployments/${hre.network.name}/${artifactName}.json`, data);
    return contract;
  }
  const {
    deployments: { deploy },
    getNamedAccounts,
  } = hre;
  const { deployer } = await getNamedAccounts();

  return await deploy(artifactName, {
    contract: contractName,
    from: deployer,
    args: args,
    log: true,
  });
}

async function transact(hre, contractArtifact, functionName, args = [], callStatic = false) {
  if (hre.network.config.zksync) {
    const wallet = new Wallet(PRIVATE_KEY);
    const deployer = new Deployer(hre, wallet);
    const contract = new Contract(contractArtifact.address, contractArtifact.abi, deployer.zkWallet);
    if (callStatic) {
      return contract.callStatic[functionName](...args, {
        customData: {
          feeToken: process.env.FEE_TOKEN || utils.ETH_ADDRESS,
        },
      });
    }
    return contract[functionName](...args, {
      customData: {
        feeToken: process.env.FEE_TOKEN || utils.ETH_ADDRESS,
      },
    });
  }
  const contract = await hre.ethers.getContractAt(contractArtifact.abi, contractArtifact.address);
  if (callStatic) return await contract.callStatic[functionName](...args);
  return await contract[functionName](...args);
}

const {
  utils: { FormatTypes },
} = require("ethers");
function getArtifact(contract) {
  return { address: contract.address, abi: JSON.parse(contract.interface.format(FormatTypes.json)) };
}

const path = require("path");
// use only inside HardhatRunTimeEnvironment
async function getContract(artifactName) {
  // eslint-disable-next-line no-undef
  const networkName = network.name;
  // eslint-disable-next-line no-undef
  if (networkName === "hardhat") return await getArtifact(await ethers.getContract(artifactName));
  const pathToArtifact = path.join(__dirname, "..", "deployments", networkName, artifactName + ".json");
  const data = JSON.parse(fs.readFileSync(pathToArtifact, { flag: "r" }));
  return { address: data.address, abi: data.abi };
}
module.exports = { transact, deployContract, getArtifact, getContract };
