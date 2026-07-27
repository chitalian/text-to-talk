const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ExecuTorch ships model weights as .pte and voice tensors as .bin. Metro has to
// treat them as assets rather than trying to parse them as source.
config.resolver.assetExts.push('pte', 'bin');

module.exports = config;
