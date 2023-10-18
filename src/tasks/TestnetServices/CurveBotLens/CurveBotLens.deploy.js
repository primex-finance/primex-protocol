module.exports = async function ({ _ }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  return await deploy("CurveBotLens", {
    from: deployer,
    args: [],
    log: true,
  });
};
