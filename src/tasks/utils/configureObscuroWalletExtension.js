// SPDX-License-Identifier: BUSL-1.1
const axios = require("axios");

module.exports = async function ({ from }, { ethers: { getNamedSigners } }) {
  const signers = await getNamedSigners();
  const addr = signers[from];

  let signValue = "";
  await axios
    .post("http://127.0.0.1:3000/generateviewingkey/", JSON.stringify({ address: addr.address.toString() }), {
      headers: { "Content-Type": "application/json" },
    })
    .then(res => {
      signValue = res.data;
    });

  const signedMsg = await addr.signMessage("vk" + signValue);
  await axios.post("http://127.0.0.1:3000/submitviewingkey/", JSON.stringify({ address: addr.address.toString(), signature: signedMsg }), {
    headers: { "Content-Type": "application/json" },
  });
  console.log("Successfully setup Wallet Extension for " + addr.address.toString());
};
