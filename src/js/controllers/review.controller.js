'use strict';

angular
  .module('copayApp.controllers')
  .controller('reviewController', reviewController);

function reviewController(addressbookService, bitcoinCashJsService, bitcore, bitcoreCash, bwcError, configService, feeService, gettextCatalog, $ionicHistory, $ionicLoading, $ionicModal, lodash, $log, ongoingProcess, platformInfo, popupService, profileService, $scope, soundService, $state, $timeout, txConfirmNotification, txFormatService, walletService) {
  var vm = this;

  vm.buttonText = '';
  vm.destination = {
    address: '',
    balanceAmount: '',
    balanceCurrency: '',
    coin: '',
    color: '',
    currency: '',
    currencyColor: '',
    kind: '', // 'address', 'contact', 'wallet'
    name: ''
  };
  vm.feeCrypto = '';
  vm.feeFiat = '';
  vm.fiatCurrency = '';
  vm.feeIsHigh = false;
  vm.feeLessThanACent = false;
  vm.isCordova = platformInfo.isCordova;
  vm.notReadyMessage = '';
  vm.origin = {
    balanceAmount: '',
    balanceCurrency: '',
    currency: '',
    currencyColor: '',
  };
  vm.originWallet = null;
  vm.primaryAmount = '';
  vm.primaryCurrency = '';
  vm.usingMerchantFee = false;
  vm.readyToSend = false;
  vm.secondaryAmount = '';
  vm.secondaryCurrency = '';
  vm.sendingTitle = gettextCatalog.getString('You are sending');
  vm.sendStatus = '';
  vm.thirdParty = false;
  vm.wallet = null;
  
  var config = null;
  var coin = '';
  var countDown = null;
  var usingCustomFee = false;
  var usingMerchantFee = false;
  var destinationWalletId = '';
  var originWalletId = '';
  var priceDisplayIsFiat = true;
  var satoshis = null;
  var toAddress = '';
  var tx = {};
  var unitFromSat = 0;

  var FEE_TOO_HIGH_LIMIT_PERCENTAGE = 15;

  $scope.$on("$ionicView.beforeEnter", onBeforeEnter);


  function onBeforeEnter(event, data) {

    originWalletId = data.stateParams.fromWalletId;
    satoshis = parseInt(data.stateParams.amount, 10);
    toAddress = data.stateParams.toAddr;
    
    vm.originWallet = profileService.getWallet(originWalletId);
    vm.origin.currency = vm.originWallet.coin.toUpperCase();
    coin = vm.originWallet.coin;

    if (data.stateParams.thirdParty) {
      vm.thirdParty = JSON.parse(data.stateParams.thirdParty); // Parse stringified JSON-object
      if (vm.thirdParty) {
        if (vm.thirdParty.id === 'shapeshift') {
          vm.sendingTitle = gettextCatalog.getString('You are shifting');
          if (!vm.thirdParty.data) {
            vm.thirdParty.data = {};
          }
          vm.thirdParty.data['fromWalletId'] = vm.fromWalletId;
        }
      }
    }

    configService.get(function onConfig(err, configCache) {
      if (err) {
        $log.err('Error getting config.', err);
      } else {
        config = configCache;
        priceDisplayIsFiat = config.wallet.settings.priceDisplay === 'fiat';
        vm.origin.currencyColor = vm.originWallet.coin === 'btc' ? config.bitcoinWalletColor : config.bitcoinCashWalletColor;
        unitFromSat = 1 / config.wallet.settings.unitToSatoshi; 
      }
      updateSendAmounts();
      getOriginWalletBalance(vm.originWallet);
      handleDestinationAsAddress(toAddress, coin);
      handleDestinationAsWallet(data.stateParams.toWalletId);
      createVanityTransaction(data);
    });
  }

  vm.approve = function() {

    if (!tx || !vm.originWallet) return;

    if ($scope.paymentExpired) {
      popupService.showAlert(null, gettextCatalog.getString('This bitcoin payment request has expired.'));
      $scope.sendStatus = '';
      $timeout(function() {
        $scope.$apply();
      });
      return;
    }

    ongoingProcess.set('creatingTx', true, statusChangeHandler);
    getTxp(lodash.clone(tx), vm.originWallet, false, function(err, txp) {
      ongoingProcess.set('creatingTx', false, statusChangeHandler);
      if (err) return;

      // confirm txs for more that 20usd, if not spending/touchid is enabled
      function confirmTx(cb) {
        if (walletService.isEncrypted(vm.originWallet))
          return cb();

        var amountUsd = parseFloat(txFormatService.formatToUSD(vm.originWallet.coin, txp.amount));
        return cb();
      };

      function publishAndSign() {
        if (!vm.originWallet.canSign() && !vm.originWallet.isPrivKeyExternal()) {
          $log.info('No signing proposal: No private key');

          return walletService.onlyPublish(vm.originWallet, txp, function(err) {
            if (err) setSendError(err);
          }, statusChangeHandler);
        }

        walletService.publishAndSign(vm.originWallet, txp, function(err, txp) {
          if (err) return setSendError(err);
          if (config.confirmedTxsNotifications && config.confirmedTxsNotifications.enabled) {
            txConfirmNotification.subscribe(vm.originWallet, {
              txid: txp.txid
            });
          }
        }, statusChangeHandler);
      };

      confirmTx(function(nok) {
        if (nok) {
          vm.sendStatus = '';
          $timeout(function() {
            $scope.$apply();
          });
          return;
        }
        publishAndSign();
      });
    });
  };

  vm.chooseFeeLevel = function(tx, wallet) {

    if (wallet.coin == 'bch') return;
    if (usingMerchantFee) return;

    var scope = $rootScope.$new(true);
    scope.network = tx.network;
    scope.feeLevel = tx.feeLevel;
    scope.noSave = true;
    scope.coin = vm.originWallet.coin;

    if (usingCustomFee) {
      scope.customFeePerKB = tx.feeRate;
      scope.feePerSatByte = tx.feeRate / 1000;
    }

    $ionicModal.fromTemplateUrl('views/modals/chooseFeeLevel.html', {
      scope: scope,
      backdropClickToClose: false,
      hardwareBackButtonClose: false
    }).then(function(modal) {
      scope.chooseFeeLevelModal = modal;
      scope.openModal();
    });
    scope.openModal = function() {
      scope.chooseFeeLevelModal.show();
    };

    scope.hideModal = function(newFeeLevel, customFeePerKB) {
      scope.chooseFeeLevelModal.hide();
      $log.debug('New fee level choosen:' + newFeeLevel + ' was:' + tx.feeLevel);

      usingCustomFee = newFeeLevel == 'custom' ? true : false;

      if (tx.feeLevel == newFeeLevel && !usingCustomFee) return;

      tx.feeLevel = newFeeLevel;
      if (usingCustomFee) tx.feeRate = parseInt(customFeePerKB);

      updateTx(tx, vm.originWallet, {
        clearCache: true,
        dryRun: true
      }, function() {});
    };
  };

  function createVanityTransaction(data) {
    console.log('createVanityTransaction()');
    var configFeeLevel = config.wallet.settings.feeLevel ? config.wallet.settings.feeLevel : 'normal';

    // Grab stateParams
    tx = {
      amount: parseInt(data.stateParams.amount),
      sendMax: data.stateParams.sendMax === 'true' ? true : false,
      fromWalletId: data.stateParams.fromWalletId,
      toAddress: data.stateParams.toAddr,
      feeLevel: configFeeLevel,
      spendUnconfirmed: config.wallet.spendUnconfirmed,

      // Vanity tx info (not in the real tx)
      recipientType: vm.destination.kind || null,
      toName: vm.destination.name || null,
      toEmail: vm.destination.email || null,
      toColor: vm.destination.color || null,
      network: false,
      coin: vm.originWallet.coin,
      txp: {},
    };

    if (data.stateParams.requiredFeeRate) {
      vm.usingMerchantFee = true;
      tx.feeRate = parseInt(data.stateParams.requiredFeeRate);
    }

    if (tx.coin && tx.coin === 'bch') {
      tx.feeLevel = 'normal';
    }

    var B = data.stateParams.coin === 'bch' ? bitcoreCash : bitcore;
    var networkName;
    try {
      if (vm.destination.kind === 'wallet') { // This is a wallet-to-wallet transfer
        $ionicLoading.show();
        var toWallet = profileService.getWallet(data.stateParams.toWalletId);

        // We need an address to send to, so we ask the walletService to create a new address for the toWallet.
        console.log('Getting address for wallet...');
        walletService.getAddress(toWallet, true, function onWalletAddress(err, addr) {
          console.log('getAddress cb called', err);
          $ionicLoading.hide();
          tx.toAddress = addr;
          networkName = (new B.Address(tx.toAddress)).network.name;
          tx.network = networkName;
          console.log('calling setupTx() for wallet.');
          setupTx(tx);
        });
      } else { // This is a Wallet-to-address transfer
        networkName = (new B.Address(tx.toAddress)).network.name;
        tx.network = networkName;
        console.log('calling setupTx() for address.');
        setupTx(tx);
      }
    } catch (e) {
      console.error('Error setting up tx', e);
      var message = gettextCatalog.getString('Invalid address');
      popupService.showAlert(null, message, function () {
        $ionicHistory.nextViewOptions({
          disableAnimate: true,
          historyRoot: true
        });
        $state.go('tabs.send').then(function () {
          $ionicHistory.clearHistory();
        });
      });
      return;
    }
  }
  function getOriginWalletBalance(originWallet) {
    var balanceText = getWalletBalanceDisplayText(vm.originWallet);
    vm.origin.balanceAmount = balanceText.amount;
    vm.origin.balanceCurrency = balanceText.currency;
  }

  function getSendMaxInfo(tx, wallet, cb) {
    if (!tx.sendMax) return cb();

    //ongoingProcess.set('retrievingInputs', true);
    walletService.getSendMaxInfo(wallet, {
      feePerKb: tx.feeRate,
      excludeUnconfirmedUtxos: !tx.spendUnconfirmed,
      returnInputs: true,
    }, cb);
  };

  function getTxp(tx, wallet, dryRun, cb) {

    // ToDo: use a credential's (or fc's) function for this
    if (tx.description && !wallet.credentials.sharedEncryptingKey) {
      var msg = gettextCatalog.getString('Could not add message to imported wallet without shared encrypting key');
      $log.warn(msg);
      return setSendError(msg);
    }

    if (tx.amount > Number.MAX_SAFE_INTEGER) {
      var msg = gettextCatalog.getString('Amount too big');
      $log.warn(msg);
      return setSendError(msg);
    }

    var txp = {};

    txp.outputs = [{
      'toAddress': tx.toAddress,
      'amount': tx.amount,
      'message': tx.description
    }];

    if (tx.sendMaxInfo) {
      txp.inputs = tx.sendMaxInfo.inputs;
      txp.fee = tx.sendMaxInfo.fee;
    } else {
      if (usingCustomFee || usingMerchantFee) {
        txp.feePerKb = tx.feeRate;
      } else txp.feeLevel = tx.feeLevel;
    }

    txp.message = tx.description;

    if (tx.paypro) {
      txp.payProUrl = tx.paypro.url;
    }
    txp.excludeUnconfirmedUtxos = !tx.spendUnconfirmed;
    txp.dryRun = dryRun;
    walletService.createTx(wallet, txp, function(err, ctxp) {
      if (err) {
        setSendError(err);
        return cb(err);
      }
      return cb(null, ctxp);
    });
  };

  function getWalletBalanceDisplayText(wallet) {
    var balanceCryptoAmount = '';
    var balanceCryptoCurrencyCode = '';
    var balanceFiatAmount = '';
    var balanceFiatCurrency = ''
    var displayAmount = '';
    var displayCurrency = '';

    var walletStatus = null;
    if (wallet.status.isValid) {
      walletStatus = wallet.status;
    } else if (wallet.cachedStatus.isValid) {
      walletStatus = wallet.cachedStatus;
    }

    if (walletStatus) {
      var cryptoBalanceParts = walletStatus.spendableBalanceStr.split(' ');
      balanceCryptoAmount = cryptoBalanceParts[0];
      balanceCryptoCurrencyCode = cryptoBalanceParts.length > 1 ? cryptoBalanceParts[1] : '';

      if (walletStatus.alternativeBalanceAvailable) {
        balanceFiatAmount = walletStatus.spendableBalanceAlternative;
        balanceFiatCurrency = walletStatus.alternativeIsoCode;
      }
    }

    if (priceDisplayIsFiat) {
      displayAmount = balanceFiatAmount ? balanceFiatAmount : balanceCryptoAmount;
      displayCurrency = balanceFiatAmount ? balanceFiatCurrency : balanceCryptoCurrencyCode;
    } else {
      displayAmount = balanceCryptoAmount;
      displayCurrency = balanceCryptoCurrencyCode;
    }

    return {
      amount: displayAmount,
      currency: displayCurrency
    };
  }

  function handleDestinationAsAddress(address, originCoin) {
    if (!address) {
      return;
    }

    // Check if the recipient is a contact
    addressbookService.get(originCoin + address, function(err, contact) { 
      if (!err && contact) {
        handleDestinationAsContact(contact);
      } else {
        vm.destination.address = address;
        vm.destination.kind = 'address';
      }
    });

  }

  function handleDestinationAsContact(contact) {
    vm.destination.kind = 'contact';
    vm.destination.name = contact.name;
    vm.destination.email = contact.email;
    vm.destination.color = contact.coin === 'btc' ? config.bitcoinWalletColor : config.bitcoinCashWalletColor;
    vm.destination.currency = contact.coin.toUpperCase();
    vm.destination.currencyColor = vm.destination.color;
  }

  function handleDestinationAsWallet(walletId) {
    destinationWalletId = walletId;
    if (!destinationWalletId) {
      return;
    }

    var destinationWallet = profileService.getWallet(destinationWalletId);
    vm.destination.coin = destinationWallet.coin;
    vm.destination.color = destinationWallet.color;
    vm.destination.currency = destinationWallet.coin.toUpperCase();
    vm.destination.kind = 'wallet';
    vm.destination.name = destinationWallet.name;

    if (config) {
      vm.destination.currencyColor = vm.destination.coin === 'btc' ? config.bitcoinWalletColor : config.bitcoinCashWalletColor; 
    }

    var balanceText = getWalletBalanceDisplayText(destinationWallet);
    vm.destination.balanceAmount = balanceText.amount;
    vm.destination.balanceCurrency = balanceText.currency;
  }

  function updateSendAmounts() {
    if (typeof satoshis !== 'number') {
      return;
    }

    var cryptoAmount = '';
    var cryptoCurrencyCode = '';
    var amountStr = txFormatService.formatAmountStr(coin, satoshis);
    if (amountStr) {
      var amountParts = amountStr.split(' ');
      cryptoAmount = amountParts[0];
      cryptoCurrencyCode = amountParts.length > 1 ? amountParts[1] : '';
    }
    // Want to avoid flashing of amount strings so do all formatting after this has returned.
    txFormatService.formatAlternativeStr(coin, satoshis, function(v) {
      if (!v) {
        vm.primaryAmount = cryptoAmount;
        vm.primaryCurrency = cryptoCurrencyCode;
        vm.secondaryAmount = '';
        vm.secondaryCurrency = '';
        return;
      }
      vm.secondaryAmount = vm.primaryAmount;
      vm.secondaryCurrency = vm.primaryCurrency;

      var fiatParts = v.split(' ');
      var fiatAmount = fiatParts[0];
      var fiatCurrency = fiatParts.length > 1 ? fiatParts[1] : '';

      if (priceDisplayIsFiat) {
        vm.primaryAmount = fiatAmount;
        vm.primaryCurrency = fiatCurrency;
        vm.secondaryAmount = cryptoAmount;
        vm.secondaryCurrency = cryptoCurrencyCode;
      } else {
        vm.primaryAmount = cryptoAmount;
        vm.primaryCurrency = cryptoCurrencyCode;
        vm.secondaryAmount = fiatAmount;
        vm.secondaryCurrency = fiatCurrency;
      }
    });
  }

  vm.onSuccessConfirm = function() {
    vm.sendStatus = '';
    $ionicHistory.nextViewOptions({
      disableAnimate: true,
      historyRoot: true
    });
    $state.go('tabs.send').then(function() {
      $ionicHistory.clearHistory();
      $state.transitionTo('tabs.home');
    });
  };

  function setButtonText(isMultisig, isPayPro) {
    if (isPayPro) {
      if (vm.isCordova) {
        vm.buttonText = gettextCatalog.getString('Slide to pay');
      } else {
        vm.buttonText = gettextCatalog.getString('Click to pay');
      }
    } else if (isMultisig) {
      if (vm.isCordova) {
        vm.buttonText = gettextCatalog.getString('Slide to accept');
      } else {
        vm.buttonText = gettextCatalog.getString('Click to accept');
      }
    } else {
      if (vm.isCordova) {
        vm.buttonText = gettextCatalog.getString('Slide to send');
      } else {
        vm.buttonText = gettextCatalog.getString('Click to send');
      }
    }
  }

  function setNotReady(msg, criticalError) {
    vn.readyToSend = false;
    vm.notReadyMessage = msg;
    $scope.criticalError = criticalError;
    $log.warn('Not ready to make the payment:' + msg);
    $timeout(function() {
      $scope.$apply();
    });
  };

  function setSendError(msg) {
    $scope.sendStatus = '';
    vm.readyToSend = false;
    $timeout(function() {
      $scope.$apply();
    });
    popupService.showAlert(gettextCatalog.getString('Error at confirm'), bwcError.msg(msg));
  };

  function setupTx(tx) {
    if (tx.coin === 'bch') {
      tx.displayAddress = bitcoinCashJsService.readAddress(tx.toAddress).cashaddr;
    } else {
      tx.displayAddress = entry.address;
    }

    addressbookService.get(tx.coin+tx.toAddress, function(err, addr) { // Check if the recipient is a contact
      if (!err && addr) {
        tx.toName = addr.name;
        tx.toEmail = addr.email;
        tx.recipientType = 'contact';
      }
    });

    // Other Scope vars
    vm.showAddress = false;


    setButtonText(vm.originWallet.credentials.m > 1, !!tx.paypro);

    if (tx.paypro)
      _paymentTimeControl(tx.paypro.expires);

    updateTx(tx, vm.originWallet, {
      dryRun: true
    }, function(err) {
      $timeout(function() {
        $scope.$apply();
      }, 10);

    });

    // setWalletSelector(tx.coin, tx.network, tx.amount, function(err) {
    //   if (err) {
    //     return exitWithError('Could not update wallets');
    //   }
    //
    //   if (vm.wallets.length > 1) {
    //     vm.showWalletSelector();
    //   } else if (vm.wallets.length) {
    //     setWallet(vm.wallets[0], tx);
    //   }
    // });
  }

  function statusChangeHandler(processName, showName, isOn) {
    $log.debug('statusChangeHandler: ', processName, showName, isOn);
    if (
      (
        processName === 'broadcastingTx' ||
        ((processName === 'signingTx') && vm.originWallet.m > 1) ||
        (processName == 'sendingTx' && !vm.originWallet.canSign() && !vm.originWallet.isPrivKeyExternal())
      ) && !isOn) {
      vm.sendStatus = 'success';

      if ($state.current.name === "tabs.send.review") { // XX SP: Otherwise all open wallets on other devices play this sound if you have been in a send flow before on that device.
        soundService.play('misc/payment_sent.mp3');
      }
      
      var channel = "firebase";
      if (platformInfo.isNW) {
        channel = "ga";
      }
      // When displaying Fiat, if the formatting fails, the crypto will be the primary amount.
      var amount = priceDisplayIsFiat ? vm.secondaryAmount || vm.primaryAmount : vm.primaryAmount;
      var log = new window.BitAnalytics.LogEvent("transfer_success", [{
        "coin": vm.originWallet.coin,
        "type": "outgoing",
        "amount": amount,
        "fees": vm.feeCrypto
      }], [channel, "adjust"]);
      window.BitAnalytics.LogEventHandlers.postEvent(log);

      $timeout(function() {
        $scope.$digest();
      }, 100);
    } else if (showName) {
      vm.sendStatus = showName;
    }
  };

  function updateTx(tx, wallet, opts, cb) {
    ongoingProcess.set('calculatingFee', true);

    if (opts.clearCache) {
      tx.txp = {};
    }

    // $scope.tx = tx;

    // function updateAmount() {
    //   if (!tx.amount) return;
    //
    //   // Amount
    //   tx.amountStr = txFormatService.formatAmountStr(originWallet.coin, tx.amount);
    //   tx.amountValueStr = tx.amountStr.split(' ')[0];
    //   tx.amountUnitStr = tx.amountStr.split(' ')[1];
    //   txFormatService.formatAlternativeStr(wallet.coin, tx.amount, function(v) {
    //     var parts = v.split(' ');
    //     tx.alternativeAmountStr = v;
    //     tx.alternativeAmountValueStr = parts[0];
    //     tx.alternativeAmountUnitStr = (parts.length > 0) ? parts[1] : '';
    //   });
    // }
    //
    // updateAmount();
    // refresh();

    var feeServiceLevel = usingMerchantFee && vm.originWallet.coin == 'btc' ? 'urgent' : tx.feeLevel;
    feeService.getFeeRate(vm.originWallet.coin, tx.network, feeServiceLevel, function(err, feeRate) {
      if (err) {
        ongoingProcess.set('calculatingFee', false);
        return cb(err);
      }

      var msg;
      if (usingCustomFee) {
        msg = gettextCatalog.getString('Custom');
        tx.feeLevelName = msg;
      } else if (usingMerchantFee) {
        $log.info('Using Merchant Fee:' + tx.feeRate + ' vs. Urgent level:' + feeRate);
        msg = gettextCatalog.getString('Suggested by Merchant');
        tx.feeLevelName = msg;
      } else {
        tx.feeLevelName = feeService.feeOpts[tx.feeLevel];
        tx.feeRate = feeRate;
      }

      getSendMaxInfo(lodash.clone(tx), wallet, function(err, sendMaxInfo) {
        if (err) {
          ongoingProcess.set('calculatingFee', false);
          var msg = gettextCatalog.getString('Error getting SendMax information');
          return setSendError(msg);
        }

        if (sendMaxInfo) {

          $log.debug('Send max info', sendMaxInfo);

          if (tx.sendMax && sendMaxInfo.amount == 0) {
            ongoingProcess.set('calculatingFee', false);
            setNotReady(gettextCatalog.getString('Insufficient confirmed funds'));
            popupService.showAlert(gettextCatalog.getString('Error'), gettextCatalog.getString('Not enough funds for fee'));
            return cb('no_funds');
          }

          tx.sendMaxInfo = sendMaxInfo;
          tx.amount = tx.sendMaxInfo.amount;
          updateAmount();
          ongoingProcess.set('calculatingFee', false);
          $timeout(function() {
            showSendMaxWarning(wallet, sendMaxInfo);
          }, 200);
        }

        // txp already generated for this wallet?
        if (tx.txp[wallet.id]) {
          ongoingProcess.set('calculatingFee', false);
          vm.readyToSend = true;
          updateSendAmounts();
          $scope.$apply();
          return cb();
        }

        console.log('calling getTxp() from getSendMaxInfo cb.');
        getTxp(lodash.clone(tx), wallet, opts.dryRun, function(err, txp) {
          ongoingProcess.set('calculatingFee', false);
          if (err) {
            if (err.message == 'Insufficient funds') {
              setNotReady(gettextCatalog.getString('Insufficient funds'));
              popupService.showAlert(gettextCatalog.getString('Error'), gettextCatalog.getString('Not enough funds for fee'));
              return cb('no_funds');
            } else
              return cb(err);
          }

          txp.feeStr = txFormatService.formatAmountStr(wallet.coin, txp.fee);
          txFormatService.formatAlternativeStr(wallet.coin, txp.fee, function(v) {
            // txp.alternativeFeeStr = v;
            // if (txp.alternativeFeeStr.substring(0, 4) == '0.00')
            //   txp.alternativeFeeStr = '< ' + txp.alternativeFeeStr;
            vm.feeFiat = v;
            vm.fiatCurrency = config.wallet.settings.alternativeIsoCode;
            if (v.substring(0, 1) === "<") {
              vm.feeLessThanACent = true;
            }
            
            console.log("fiat", vm.feeFiat);

          });

          var per = (txp.fee / (txp.amount + txp.fee) * 100);
          var perString = per.toFixed(2);
          txp.feeRatePerStr = (perString == '0.00' ? '< ' : '') + perString + '%';
          txp.feeToHigh = per > FEE_TOO_HIGH_LIMIT_PERCENTAGE;
          vm.feeCrypto = (unitFromSat * txp.fee).toFixed(8);
          vm.feeIsHigh = txp.feeToHigh;
          console.log("crypto", vm.feeCrypto);


          tx.txp[wallet.id] = txp;
          $log.debug('Confirm. TX Fully Updated for wallet:' + wallet.id, tx);
          vm.readyToSend = true;
          updateSendAmounts();
          console.log('readyToSend:', vm.readyToSend);
          $scope.$apply();

          return cb();
        });
      });
    });
  }

  function _paymentTimeControl(expirationTime) {
    $scope.paymentExpired = false;
    setExpirationTime();

    countDown = $interval(function() {
      setExpirationTime();
    }, 1000);

    function setExpirationTime() {
      var now = Math.floor(Date.now() / 1000);

      if (now > expirationTime) {
        setExpiredValues();
        return;
      }

      var totalSecs = expirationTime - now;
      var m = Math.floor(totalSecs / 60);
      var s = totalSecs % 60;
      $scope.remainingTimeStr = ('0' + m).slice(-2) + ":" + ('0' + s).slice(-2);
    };

    function setExpiredValues() {
      $scope.paymentExpired = true;
      $scope.remainingTimeStr = gettextCatalog.getString('Expired');
      if (countDown) $interval.cancel(countDown);
      $timeout(function() {
        $scope.$apply();
      });
    };
  };

}
