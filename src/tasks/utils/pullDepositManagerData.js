// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { network, ethers: { getContract, provider } }) {
  const fs = require("fs");

  const blocksAgo = 4740000; //

  const latestTimeBlock = (await provider.getBlock("latest")).number;
  const block = await provider.getBlock(latestTimeBlock - blocksAgo);
  console.log(`Parse from: ${new Date(block.timestamp * 1000)}`);

  const depositManager = await getContract("DepositManager");

  const filter = depositManager.filters.FixedTermDepositCreated(null, null, null, null, null);
  const logsFrom = await depositManager.queryFilter(filter, -blocksAgo);
  const data = [];

  for (let i = 0; i < logsFrom.length; i++) {
    data.push({
      receiver: logsFrom[i].args.depositReceiver,
      bucket: logsFrom[i].args.bucket,
      depositId: logsFrom[i].args.depositId.toString(),
      amount: logsFrom[i].args.amount.toString(),
      duration: logsFrom[i].args.duration.toString(),
    });
  }
  fs.writeFileSync(`./depositManagerData_${network.name}.json`, JSON.stringify(data, null, 2));
};
