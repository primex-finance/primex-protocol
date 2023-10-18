const fs = require("fs");
const path = require("path");
const axios = require("axios");

module.exports = async function ({ _ }, { network }) {
  // The Eternal has stopped supporting firebase synchronization so we are doing this through a post request
  const deployments = `./deployments/${network.name}`;
  const params = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ETHERNAL_TOKEN}`,
    },
  };
  const promises = [];
  try {
    // Get the files as an array
    const files = await fs.promises.readdir(deployments);
    for (const file of files) {
      if (fs.lstatSync(`${deployments}/${file}`).isDirectory()) {
        continue;
      }
      let data = await fs.promises.readFile(`${deployments}/${file}`);
      data = JSON.parse(data);

      if (data.address) {
        const promise = axios.post(
          `https://api.tryethernal.com/api/contracts/${data.address}`,
          {
            data: {
              workspace: process.env.ETHERNAL_WORKSPACE,
              name: path.parse(file).name,
              abi: JSON.stringify(data.abi),
            },
          },
          params,
        );
        promises.push(promise);
      }
    }
  } catch (e) {
    console.error(e);
  }
  try {
    await Promise.all(promises);
    console.log("The contracts have been synchronized");
  } catch (e) {
    console.error(e);
  }
};
