'use strict';

// https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki
// https://github.com/bitcoin/bips/blob/master/bip-0072.mediawiki

(function(){

  angular
    .module('bitcoincom.services')
    .factory('bitcoinUriService', bitcoinUriService);
    
  function bitcoinUriService(bitcoinCashJsService, bwcService, $log) {
    var bch = bitcoinCashJsService.getBitcoinCashJs();
    var bitcore = bwcService.getBitcore();
    var cashAddrRe = /^((?:q|p)[a-z0-9]{41})|((?:Q|P)[A-Z0-9]{41})$/;

    var service = {
     parse: parse 
    };

    return service;

    function generateTestData() {
      var privateKey = new bch.PrivateKey('testnet');
      var address1 = privateKey.toAddress();
      console.log('legacy pub:', address1.toString());
      //var addrss = bitcoinCashJsService.readAddress(address1);
      //console.log('generated:', addrss.cashaddr);
      //bch.Address.fromString(address1, 'testnet');
      console.log('generated:', address1.toString('cashaddr'));
     
    }
    
    function bitpayAddrOnMainnet(address) {
      var Address = bch.Address;
      var BitpayFormat = Address.BitpayFormat;

      var mainnet = bch.Networks.mainnet;

      var result = null;
      if (address[0] == 'C') {
        try {
          result = Address.fromString(address, mainnet, 'pubkeyhash', BitpayFormat);
        } catch (e) {};

      } else if (address[0] == 'H') {
        try {
          result = Address.fromString(address, mainnet, 'scripthash', BitpayFormat);
        } catch (e) {};

      }
      return result;
    }


    function cashAddrOnMainnet(address) {
      var Address = bch.Address;
      var CashAddrFormat = Address.CashAddrFormat;

      var mainnet = bch.Networks.mainnet;

      var prefixed = 'bitcoincash:' + address;
      var result = null;
      if (address[0] == 'q') {
        try {
          result = Address.fromString(prefixed, mainnet, 'pubkeyhash', CashAddrFormat);
        } catch (e) {};

      } else if (address[0] == 'p') {
        try {
          result = Address.fromString(prefixed, mainnet, 'scripthash', CashAddrFormat);
        } catch (e) {};

      }
      return result;
    }

    function cashAddrOnTestnet(address) {
      var Address = bch.Address;
      var CashAddrFormat = Address.CashAddrFormat;

      var testnet = bch.Networks.testnet;

      var prefixed = 'bchtest:' + address;
      var result = null;
      if (address[0] == 'q') {
        try {
          result = Address.fromString(prefixed, testnet, 'pubkeyhash', CashAddrFormat);
        } catch (e) {};

      } else if (address[0] == 'p') {
        try {
          result = Address.fromString(prefixed, testnet, 'scripthash', CashAddrFormat);
        } catch (e) {};

      }
      return result;
    }

    function isValidCashAddr(address, network) {
      
      var a = address.replace('bitcoincash:', '');
      var result = {};
      if (a[0] == '1') {
        result = Address.fromString(a, 'livenet', 'pubkeyhash');
      } else if (a[0] == '3') {
        result = Address.fromString(a, 'livenet', 'scripthash');
      } else if (a[0] == 'C') {
        result = Address.fromString(a, 'livenet', 'pubkeyhash', BitpayFormat);
      } else if (a[0] == 'H') {
        result = Address.fromString(a, 'livenet', 'scripthash', BitpayFormat);
      } else if (a[0] == 'q') {
        result = Address.fromString(address, 'livenet', 'pubkeyhash', CashAddrFormat);
      } else if (a[0] == 'p') {
        result = Address.fromString(address, 'livenet', 'scripthash', CashAddrFormat);
      } else {
        return null;
      }

      var isValid = false;

      var prefix = network === 'testnet' ? 'bchtest:' : 'bitcoincash:';

      try {
        if (cashAddrRe.test(address)) {
          // bitcoinCashJs.Address.isValid() assumes legacy address for string data, so does not work with cashaddr.
          var bchAddresses = bitcoinCashJsService.readAddress(address.toLowerCase());
          if (bchAddresses) {
            var legacyAddress = bchAddresses.legacy;
            if (bch.Address.isValid(legacyAddress, network)) {
              isValid = true;
            }
          }
        }
      } catch (e) {
        // Nop - Must not be a valid cashAddr.
        $log.error('Error validating address.', e);
      }
      console.log(address,'isValidCashAddr:', isValid);
      return isValid;
    }
    

    /*
    For parsing:
      BIP21
      BIP72

    returns: 
    {
      address: '',
      amount: '',
      coin: '',
      isValid: false,
      label: '',
      legacyAddress: '',
      message: '',
      other: {
        somethingIDontUnderstand: 'Its value'
      },
      req: {
        "req-param0": "",
        "req-param1": ""
      },
      testnet: false,
      url: ''

    }

    // Need to do testnet, and copay too

    */
   // bitcoincash:?r=https://bitpay.com/i/GLRoZMZxaWBqLqpoXexzoD
    function parse(uri) {
      var parsed = {
        isValid: false
      };

      // Identify prefix
      var trimmed = uri.trim();
      var colonSplit = /^([\w-]*):?(.*)$/.exec(trimmed);
      if (!colonSplit) {
        return parsed;
      }

      var addressAndParams = '';
      var preColonLower = colonSplit[1].toLowerCase();
      if (preColonLower === 'bitcoin') {
        parsed.coin = 'btc';
        addressAndParams = colonSplit[2];
        console.log('Is btc');

      } else if (/^(?:bitcoincash)|(?:bitcoin-cash)$/.test(preColonLower)) {
        parsed.coin = 'bch';
        parsed.test = false;
        addressAndParams = colonSplit[2];
        console.log('Is bch');

      } else if (/^(?:bchtest)$/.test(preColonLower)) {
        parsed.coin = 'bch';
        parsed.testnet = true;
        addressAndParams = colonSplit[2];
        console.log('Is bch');

      } else if (colonSplit[2] === '') {
        // No colon and no coin specifier.
        addressAndParams = colonSplit[1];
        console.log('No prefix.');

      } else {
        // Something with a colon in the middle that we don't recognise
        return parsed;
      }

      // Remove erroneous leading slashes
      var leadingSlashes = /^\/*([^\/]+(?:.*))$/.exec(addressAndParams);
      if (!leadingSlashes) {
        return parsed;
      }
      addressAndParams = leadingSlashes[1];

      var questionMarkSplit = /^([^\?]*)\??([^\?]*)$/.exec(addressAndParams);
      if (!questionMarkSplit) {
        return parsed;
      }

      var address = questionMarkSplit[1];
      var params = questionMarkSplit[2];
  
      if (params.length > 0) {
        var paramsSplit = params.split('&');
        var others;
        var req;
        var paramCount = paramsSplit.length;
        for(var i = 0; i < paramCount; i++) {
          var param = paramsSplit[i];
          var valueSplit = param.split('=');
          if (valueSplit.length !== 2) {
            return parsed;
          }

          var key = valueSplit[0];
          var value = valueSplit[1];
          var decodedValue = decodeURIComponent(value);
          switch(key) {
            case 'amount':
            var amount = parseFloat(decodedValue);
              if (amount) { // Checking for NaN, or no numbers at all etc.
                parsed.amount = decodedValue;
              } else {
                return parsed;
              }  
            break;

            case 'label':
              parsed.label = decodedValue;
            break;

            case 'message':
              parsed.message = decodedValue;
            break;

            case 'r':
              // Could use a more comprehesive regex to test URL validity, but then how would we know
              // which part of the validation it failed?
              if (decodedValue.startsWith('https://')) {
                parsed.url = decodedValue;
              } else {
                return parsed;
              }
            break;

            default:
              if (key.startsWith('req-')) {
                req = req || {};
                req[key] = decodedValue;
              } else {
                others = others || {};
                others[key] = decodedValue;
              }
          }

        };
      }

      parsed.others = others;
      parsed.req = req;
      
      
      // Need to do bitpay format as well? Probably
      if (address) {
        var addressLowerCase = address.toLowerCase();
        var bch = bitcoinCashJsService.getBitcoinCashJs();
        // Just a rough validation to exclude half-pasted addresses, or things obviously not bitcoin addresses
        var cashAddrRe = /^((?:q|p)[a-z0-9]{41})|((?:Q|P)[A-Z0-9]{41})$/;
        
        //var legacyRe = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
        //var legacyTestnetRe = /^[mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
        var bitpayAddrMainnet = bitpayAddrOnMainnet(address);
        var cashAddrTestnet = cashAddrOnTestnet(addressLowerCase);
        var cashAddrMainnet = cashAddrOnMainnet(addressLowerCase);

        if (parsed.testnet && cashAddrTestnet) {
          parsed.address = addressLowerCase;
          parsed.coin = 'bch';
          parsed.legacyAddress = cashAddrTestnet.toString();
          
        } else if (cashAddrMainnet) {
          parsed.address = addressLowerCase;
          parsed.coin = 'bch';
          parsed.legacyAddress = cashAddrMainnet.toString();
          parsed.testnet = false;  

        } else if (bitcore.Address.isValid(address, 'livenet') && parsed.coin !== 'bch') {
          parsed.address = address;
          parsed.legacyAddress = address;
          parsed.testnet = false;

        } else if (bitcore.Address.isValid(address, 'testnet')  && parsed.coin !== 'bch') {
          parsed.address = address;
          parsed.legacyAddress = address;
          parsed.testnet = true;

        } else if (bitpayAddrMainnet) {
          parsed.address = address;
          parsed.coin = 'bch';
          parsed.legacyAddress = bitpayAddrMainnet.toString();
          parsed.testnet = false;  
        }
          
      }



      // TODO: Check for a private key here too, including WIF format, etc.
      

      // If has no address, must have Url.
      parsed.isValid = !!(parsed.address || parsed.url);

      return parsed;
    }

  }  

})();