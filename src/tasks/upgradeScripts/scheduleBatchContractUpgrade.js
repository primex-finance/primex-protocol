// SPDX-License-Identifier: BUSL-1.1

module.exports = async function (
  { params },
  {
    upgrades,
    getNamedAccounts,
    ethers: {
      getContract,
      getContractFactory,
      constants: { HashZero },
      utils: { keccak256, toUtf8Bytes },
    },
  },
) {
  params = JSON.parse(params);

  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const { deployer } = await getNamedAccounts();
  const delay = await bigTimeLock.getMinDelay();
  const value = 0;
  const predecessor = HashZero;
  const salt = HashZero;
  const args = [[], [], []];

  for (const contractParams of params) {
    const {
      newImplContractLibraries,
      isBeacon,
      proxyAddress,
      newImplContractArtifactName,
      oldImplContractArtifactName,
      oldImplContractLibraries,
    } = contractParams;

    const newImplFactory = await getContractFactory(
      newImplContractArtifactName,
      newImplContractLibraries
        ? {
          libraries: newImplContractLibraries,
        }
        : {},
    );

    const oldImplFactory = await getContractFactory(
      oldImplContractArtifactName,
      oldImplContractLibraries
        ? {
          libraries: oldImplContractLibraries,
        }
        : {},
    );

    const proxyKind = isBeacon === "true" ? { kind: "beacon", method: "upgradeBeacon" } : { kind: "transparent", method: "upgrade" };

    await upgrades.forceImport(proxyAddress, oldImplFactory, { kind: proxyKind.kind });
    await upgrades.validateUpgrade(proxyAddress, newImplFactory, {
      unsafeAllow: ["delegatecall", "constructor", "external-library-linking"],
    });
    await upgrades.validateUpgrade(oldImplFactory, newImplFactory, {
      unsafeAllow: ["delegatecall", "constructor", "external-library-linking"],
    });
    console.log(`New implementation ${newImplContractArtifactName} is validated!`);

    const newImplContract = await getContract(newImplContractArtifactName);
    const data = await encodeFunctionData(proxyKind.method, [proxyAddress, newImplContract.address], "PrimexProxyAdmin");
    args[0].push(data.contractAddress);
    args[1].push(value);
    args[2].push(data.payload);
  }

  args.push(predecessor, salt, delay);
  if (await bigTimeLock.hasRole(keccak256(toUtf8Bytes("PROPOSER_ROLE")), deployer)) {
    const tx = await bigTimeLock.scheduleBatch(...args);
    await tx.wait();
    console.log(`Batch upgrade is scheduled in ${delay} seconds`);
  } else {
    console.log("Upgrade is not scheduled.");
    console.log("The caller does not have the PROPOSER_ROLE");
  }
  console.log(
    `scheduleBatch transaction data: \n targets: ${args[0]}, \n values: ${args[1]}, \n payloads: ${args[2]}, \n predecessor: ${predecessor}, \n salt: ${salt}, \n delay in sec: ${delay}`,
  );
  args.pop();
  return args;
};
