"use strict";
var socket = io();

$(document).ready(function() {
  // Stale menu icon hook removed safely

  socket.on("pairStatus", function(payload) {
    var pairEnabled = payload.pairEnabled;

    if (pairEnabled === true) {
      showSection("nowPlaying");
    } else {
      showSection("pairDisabled");
    }
  });
});

function showSection(sectionName) {
  // Clear the active visual state from all header tabs
  $(".navHeaderBtn").removeClass("active-nav");

  switch (sectionName) {
    case "nowPlaying":
      $("#topNavContainer").show();
      $("#navBtnNowPlaying").addClass("active-nav");
      // Show Now Playing screen
      $("#nowPlaying").show();
      // Hide inactive sections
      $("#pairDisabled").hide();
      $("#libraryBrowser").hide();
      break;
    case "libraryBrowser":
      $("#topNavContainer").show();
      $("#navBtnLibrary").addClass("active-nav");
      // Show libraryBrowser
      $("#libraryBrowser").show();
      // Hide inactive sections
      $("#pairDisabled").hide();
      $("#nowPlaying").hide();
      break;
    case "pairDisabled":
      // Show pairDisabled section
      $("#pairDisabled").show();
      // Hide everything else
      $("#topNavContainer").hide();
      $("#libraryBrowser").hide();
      $("#nowPlaying").hide();
      $("#pageLoading").hide();
      break;
    default:
      break;
  }
  var t = setTimeout(function() {
    $("#pageLoading").hide();
  }, 250);
}