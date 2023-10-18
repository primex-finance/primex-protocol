module.exports = async function ({ errorsLibrary }, { getNamedAccounts, ethers: { getContract }, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  return await deploy("BalancerBotLens", {
    from: deployer,
    args: [],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });
};
