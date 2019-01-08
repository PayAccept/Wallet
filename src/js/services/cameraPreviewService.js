'use strict';

angular.module('bitcoincom.services').service('cameraPreviewService', function($log
  , $timeout
  , platformInfo
  , $rootScope
  , $window
  ) {

  var isDesktop = !platformInfo.isCordova;
  var CameraPreview = $window.CameraPreview;
  var lightEnabled = false;
  var backCamera = true; // the plugin defaults to the back camera

  // Initalize known capabilities
  // Assume camera is available. If init fails, we'll set this to false.
  var isAvailable = true;
  var hasPermission = false;
  var isDenied = false;
  var isRestricted = false;
  var canEnableLight = false;
  var canChangeCamera = false;
  var canOpenSettings = false;

  function _checkCapabilities(status) {
    $log.debug('scannerService is reviewing platform capabilities...');
    // Permission can be assumed on the desktop builds
    hasPermission = (isDesktop || status.authorized) ? true : false;
    isDenied = status.denied ? true : false;
    isRestricted = status.restricted ? true : false;
    canEnableLight = status.canEnableLight ? true : false;
    canChangeCamera = status.canChangeCamera ? true : false;
    canOpenSettings = status.canOpenSettings ? true : false;
    _logCapabilities();
  }

  var defaultCameraSettings = {
    camera: CameraPreview.CAMERA_DIRECTION.BACK
    , toBack: true
    , tapPhoto: false
    , tapFocus: true
    , previewDrag: false
  };

  var defaultImageSettings = {

  }

  var defaultDocumentSettings = {

  }

  // function _initSettings() {
  //   var options = {
  //     x: 0
  //     , y: 0
  //     , width: $window.screen.width
  //     , height: $window.screen.height
  //     , camera: CameraPreview.CAMERA_DIRECTION.BACK
  //     , toBack: true
  //     , tapPhoto: false
  //     , tapFocus: true
  //     , previewDrag: false
  //     , disableExifHeaderStripping: true
  //   };
  // }

  this.startCamera = function (options = defaultCameraSettings) {
    CameraPreview.startCamera(options, [function onStartCameraSuccess() {
      console.log('Camera Preview Started!');
      return;
    }, function onStartCameraError(err) {
      $log.debug('Camera Preview Failed to start on request');
      }]);
  }

  this.stopCamera = function () {
    return CameraPreview.stopCamera(
      function onStopCameraSuccess() {
        return;
      },
      function onCameraStopError(err) {
        $log.debug('Camera Preview Failed to stop on request');
      }
    );
  }

  this.takePicture = function (options = defaultDocumentSettings, callback ) {
    CameraPreview.takePicture(options, function(base64PictureData){
      callback(base64PictureData);
    });
  }

  function setPreviewSize() {

  }

  // getCameraCharacteristics

});