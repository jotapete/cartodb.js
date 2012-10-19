(function() {
// if google maps is not defined do not load the class
if(typeof(google) == "undefined" || typeof(google.maps) == "undefined")
  return;

// helper to get pixel position from latlon
var Projector = function(map) { this.setMap(map); };
Projector.prototype = new google.maps.OverlayView();
Projector.prototype.draw = function() {};
Projector.prototype.latLngToPixel = function(point) {
  var p = this.getProjection();
  if(p) {
    return p.fromLatLngToContainerPixel(point);
  }
  return [0, 0];
};
Projector.prototype.pixelToLatLng = function(point) {
  var p = this.getProjection();
  if(p) {
    return p.fromContainerPixelToLatLng(point);
  }
  return [0, 0];
  //return this.map.getProjection().fromPointToLatLng(point);
};

var CartoDBLayer = function(opts) {

  var default_options = {
    query:          "SELECT * FROM {{table_name}}",
    opacity:        1,
    auto_bound:     false,
    debug:          false,
    visible:        true,
    added:          false,
    loaded:         null,
    loading:        null,
    layer_order:    "top",
    tiler_domain:   "cartodb.com",
    tiler_port:     "80",
    tiler_protocol: "http",
    sql_domain:     "cartodb.com",
    sql_port:       "80",
    sql_protocol:   "http"
  };

  this.options = _.defaults(opts, default_options);
  opts.tiles = [
    this._tilesUrl()
  ];
  wax.g.connector.call(this, opts);

  // lovely wax connector overwrites options so set them again
  // TODO: remove wax.connector here
   _.extend(this.options, opts);
  this.projector = new Projector(opts.map);
  this._addInteraction();
};

CartoDBLayer.Projector = Projector;

CartoDBLayer.prototype = new wax.g.connector();
_.extend(CartoDBLayer.prototype, CartoDBLayerCommon.prototype);

CartoDBLayer.prototype.setOpacity = function(opacity) {

  this._checkLayer();

  if (isNaN(opacity) || opacity > 1 || opacity < 0) {
    throw new Error(opacity + ' is not a valid value, should be in [0, 1] range');
  }
  this.opacity = this.options.opacity = opacity;
  for(var key in this.cache) {
    var img = this.cache[key];
    img.setAttribute("style","opacity: " + opacity + "; filter: alpha(opacity="+(opacity*100)+");");
  }

};

CartoDBLayer.prototype.getTile = function(coord, zoom, ownerDocument) {
  this.options.added = true;
  return wax.g.connector.prototype.getTile.call(this, coord, zoom, ownerDocument);
}

CartoDBLayer.prototype._addInteraction = function () {
  var self = this;
  // add interaction
  if(this._interaction) {
    return;
  }
  this._interaction = wax.g.interaction()
    .map(this.options.map)
    .tilejson(this._tileJSON());
  this.setInteraction(true);
};

CartoDBLayer.prototype.clear = function () {
  if (this._interaction) {
    this._interaction.remove();
    delete this._interaction;
  }
};

CartoDBLayer.prototype.update = function () {
  var tilejson = this._tileJSON();
  // clear wax cache
  this.cache = {};
  this.options.tiles = tilejson.tiles;
  this._interaction.tilejson(tilejson);
};


/**
 * Active or desactive interaction
 * @params {Boolean} Choose if wants interaction or not
 */
CartoDBLayer.prototype.setInteraction = function(enable) {
  var self = this;

  if (this._interaction) {
    if (enable) {
      this._interaction
        .on('on',function(o) {
          self._manageOnEvents(self.options.map, o);
        })
        .on('off', function(o) {
          self._manageOffEvents();
        });
    } else {
      this._interaction.off('on');
      this._interaction.off('off');
    }
  }
};


CartoDBLayer.prototype.setOptions = function (opts) {
  _.extend(this.options, opts);
  if(this.options.interactivity) {
    var i = this.options.interactivity
    this.options.interactivity = i.join ? i.join(','): i;
  }
  this.setOpacity(this.options.opacity);
  this.setInteraction(this.options.interaction);

  this.update();
}

CartoDBLayer.prototype._checkLayer = function() {
  if (!this.options.added) {
    throw new Error('the layer is not still added to the map');
  }
}
/**
 * Change query of the tiles
 * @params {str} New sql for the tiles
 * @params {Boolean}  Choose if the map fits to the sql results bounds (thanks to @fgblanch)
*/
CartoDBLayer.prototype.setQuery = function(sql) {

  this._checkLayer();

  if (!sql) {
    throw new Error('sql is not a valid query');
  }

  /*if (fitToBounds)
    this.setBounds(sql)
    */

  // Set the new value to the layer options
  this.options.query = sql;
  this._update();
}

CartoDBLayer.prototype.isVisible = function() {
  return this.options.visible;
}

CartoDBLayer.prototype.setCartoCSS = function(style, version) {

  this._checkLayer();

  if (!style) {
    throw new Error('should specify a valid style');
  }

  // Set the new value to the layer options
  this.options.tile_style = style;
  this._update();
}


/**
 * Change the query when clicks in a feature
 * @params { Boolean || String } New sql for the request
 */
CartoDBLayer.prototype.setInteractivity = function(fieldsArray) {

  this._checkLayer();

  if (!fieldsArray) {
    throw new Error('should specify fieldsArray');
  }

  // Set the new value to the layer options
  this.options.interactivity = fieldsArray.join ? fieldsArray.join(','): fieldsArray;
  // Update tiles
  this._update();
}



CartoDBLayer.prototype._findPos = function (map,o) {
      var curleft, cartop;
      curleft = curtop = 0;
      var obj = map.getDiv();
      // Modern browsers
      if (obj.offsetParent) {
        do {
          curleft += obj.offsetLeft;
          curtop += obj.offsetTop;
        } while (obj = obj.offsetParent);
        return new google.maps.Point(
            (o.e.clientX || o.e.changedTouches[0].clientX) - curleft,
            (o.e.clientY || o.e.changedTouches[0].clientY) - curtop
        );
      } else {
        // IE
        return new google.maps.Point(o.e);
      }
};

CartoDBLayer.prototype._manageOffEvents = function(){
  if (this.options.featureOut) {
    return this.options.featureOut && this.options.featureOut();
  }
};


CartoDBLayer.prototype._manageOnEvents = function(map,o) {
  var point  = this._findPos(map, o),
      latlng = this.projector.pixelToLatLng(point);

  switch (o.e.type) {
    case 'mousemove':
      if (this.options.featureOver) {
        return this.options.featureOver(o.e,latlng, point, o.data);
      }
      break;

    case 'click':
    case 'touchend':
      if (this.options.featureClick) {
        this.options.featureClick(o.e,latlng, point, o.data);
      }
      break;
    default:
      break;
  }
}



cdb.geo.CartoDBLayerGMaps = CartoDBLayer;

/**
* gmaps cartodb layer
*/

var GMapsCartoDBLayerView = function(layerModel, gmapsMap) {
  var self = this;

  _.bindAll(this, 'featureOut', 'featureOver', 'featureClick');

  var opts = _.clone(layerModel.attributes);

  opts.map =  gmapsMap;

  var // preserve the user's callbacks
  _featureOver  = opts.featureOver,
  _featureOut   = opts.featureOut,
  _featureClick = opts.featureClick;

  opts.featureOver  = function() {
    _featureOver  && _featureOver.apply(this, arguments);
    self.featureOver  && self.featureOver.apply(this, arguments);
  };

  opts.featureOut  = function() {
    _featureOut  && _featureOut.apply(this, arguments);
    self.featureOut  && self.featureOut.apply(this, arguments);
  };

  opts.featureClick  = function() {
    _featureClick  && _featureClick.apply(this, arguments);
    self.featureClick  && self.featureClick.apply(opts, arguments);
  };

  cdb.geo.CartoDBLayerGMaps.call(this, opts);
  cdb.geo.GMapsLayerView.call(this, layerModel, this, gmapsMap);
};

cdb.geo.GMapsCartoDBLayerView = GMapsCartoDBLayerView;


_.extend(
  GMapsCartoDBLayerView.prototype,
  cdb.geo.GMapsLayerView.prototype,
  cdb.geo.CartoDBLayerGMaps.prototype,
  {

  _update: function() {
    _.extend(this.options, this.model.attributes);
    this.update();
    this.refreshView();
  },

  remove: function() {
    cdb.geo.GMapsLayerView.prototype.remove.call(this);
    this.clear();
  },

  featureOver: function(e, latlon, pixelPos, data) {
    // dont pass gmaps LatLng
    this.trigger('featureOver', e, [latlon.lat(), latlon.lng()], pixelPos, data);
  },

  featureOut: function(e) {
    this.trigger('featureOut', e);
  },

  featureClick: function(e, latlon, pixelPos, data) {
    // dont pass leaflet lat/lon
    this.trigger('featureClick', e, [latlon.lat(), latlon.lng()], pixelPos, data);
  }

});

})();