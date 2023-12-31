// SPDX-License-Identifier: BUSL-1.1

const userAccounts = [
  "0x1CBB58F9A2e37873Cc8b3f894F9aa09289fDBFCF",
  "0x2677295dF0833Cd12CDcd0139A464D17659db6C4",
  "0xEEE58034F866fcC5FdC6aC57052660CF1b086B8A",
  "0x130ff48A84B05029fB18bD38fBD2467FC2E777dC",
  "0xc25051262bF3cB112f114bC7968836F0dE0f942B",
  "0x8E34F01271E09cce78BDc61f782a7297e670bF48",
  "0xb251E74d7c7188E85708b76b3e34d1237E8EB460",
  "0xCb6fA90Ad8aE3391cfe6C84157d543C2a4747861",
  "0xda1C55f3818E85e34f675902Ec656E417043d154",
  "0x671a6A88721Ca0608C0Bee56dD376Fc536F2ee5E",
  "0x9bF6C4B62A49A36089d5727d2050dc9f049c7027",
  "0xA75662b44580efB92e7615c75Fc1B5b6aBD1eefa",
  "0x1093BDB641EfA08954847d83CA9e724E1d6f6546",
  "0x64565B2BFC88c51aE7aB672123e0A8D6210213c8",
  "0x0fc02619E5F618B50Af49CC95EB4103892cb51fD",
  "0x5d0F8953C9C7B8db7487eeF4dCaDFAb159FB0aBC",
  "0xC0acac9EcBb9f1c5b3046381CCfd4F977f0B02A7",
  "0xa3C29754a338C85c4E370B1Ae3dF5dCDb423EcD6",
  "0x652648C8Cd4171Af8EF727BA69316bD2024F748b",
  "0x17Ac387563858378E2Ae4dA00bd815559Cf0107F",
];

const botAccounts = [
  "0xb2ee58239e58d50c9c6ec01b3b792b2798fdcff2", // keeper for order and position
  "0x8b268ba5ac8665e2fa8fa3966dee2d0e709f0060", // meshswap synchronization bot
  "0x6d36143540aab8a3472c47975877e409050122af", // mainnet synchronization uniswap v2 bot
  "0x3329a7092369c64e5c5f5cf9b9c808013c4dd8bb", // mainnet synchronization uniswap v3 bot
  "0xAFE091b8191F63d63016137aE93Dd6C67F5C7F8f", // oracle price bot
  "0xb36e78708DC1F4919C00d364D6De84E92220B10a", // curve synchronization bot
  "0x1160F7c043C643fC6dEa6F2Dc1FdC84186968B08", // balancer synchronization bot
  "0xC335e16F526c00716C376fdc98739a9F7Eb13278", // quickswapv3 synchronization bot
];

module.exports = { userAccounts, botAccounts };
