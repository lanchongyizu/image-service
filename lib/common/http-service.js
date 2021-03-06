// Copyright 2015, EMC, Inc.

'use strict';

var di = require('di');
var express = require('express');
var directory = require("serve-index");
var cors = require('cors');
var http = require('http');

module.exports = httpServiceFactory;

di.annotate(httpServiceFactory, new di.Provide('Http.Server'));
di.annotate(httpServiceFactory,
    new di.Inject(
        'Services.Configuration',
        'Logger',
        'Promise',
        '_',
        'northbound-api',
        di.Injector
    )
);

/**
 * Factory that creates the express http service
 * @private
 * @param {Services.Configuration} configuration
 * @param Logger
 * @param Q
 * @param injector
 * @returns {function} HttpService constructor
 */
function httpServiceFactory(
    configuration,
    Logger,
    Promise,
    _,
    NorthboundApi
) {
    var logger = Logger.initialize("httpService");
    var northboundApi = new NorthboundApi();

    function HttpService(endpoint) {
        this.app = express();
        this.endpoint = this._parseEndpoint(endpoint);
        this.server = null;
        this._setup();
    }

    HttpService.prototype.start = function () {
        var self = this;
        var sockets = [];

        this.server = http.createServer(this.app);

        this.server.on('close', function () {
            // make sure all connections are closed.
            sockets.forEach(function (socket) {
                socket.destroy();
            });
            logger.info('Server Closing.');
        });

        this.server.on('connection', function (socket) {
            sockets.push(socket);
        });

        return new Promise(function (resolve, reject) {
            return self.server.listen(
                self.endpoint.port,
                self.endpoint.address,
                function (error) {
                    if (error) {
                        logger.error('Service start error', error);
                    }
                    var httpTimeout = configuration.get("httpTimeout", 86400000); // 24 Hours
                    self.server.timeout = httpTimeout; // 24 Hours
                    return error ? reject(error) : resolve();
                });
        });
    };

    HttpService.prototype.stop = function () {
        var self = this;

        return new Promise(function (resolve, reject) {
            return self.server.close(
                function (error) {
                    return error ? reject(error) : resolve();
                });
        });
    };

    HttpService.prototype._setup = function () {
        var app = this.app;
        var endpoint = this.endpoint;

        // ORS Support
        app.use(cors());
        app.options('*', cors());

        // Parse request body. Limit set to 50MB
        // app.use(bodyParser.json({ limit: '50mb' }));

        var httpFileServiceRootDir = configuration.get('httpFileServiceRootDir',
            './static/http');
        var httpFileServiceApiRoot = configuration.get('httpFileServiceApiRoot', '/');

        if (_.includes(endpoint.routers, 'southbound')) {
            // static file server
            app.use(httpFileServiceApiRoot, express.static(httpFileServiceRootDir,
                {dotfiles: 'allow'}
            ));

            // static file server with UI
            app.use(httpFileServiceApiRoot, directory(httpFileServiceRootDir,
                {
                    'icons': true,
                    'hidden': true
                }
            ));

            logger.info("Static file server defined at API: http://" +
                endpoint.address + ":" + endpoint.port + httpFileServiceApiRoot);
        }

        if (_.includes(endpoint.routers, 'northbound')) {
            app.use(httpFileServiceApiRoot, express.static(httpFileServiceRootDir + "/gui",
                {dotfiles: 'allow'}
            ));

            app.use('/', northboundApi.getRouter());

            logger.info("Northbound API defined at http://" +
                endpoint.address + ":" + endpoint.port);
        }
    };

    HttpService.prototype._parseEndpoint = function (endpoint) {
        function parseRouterNames(routers) {
            if (_.isEmpty(routers)) {
                return ['northbound', 'southbound'];
            } else {
                if (_.isString(routers)) {
                    return [routers];
                }
                if (_.isArray(routers) && _.all(routers, _.isString)) {
                    return routers;
                }
                return ['northbound', 'southbound'];
            }
        }

        return {
            address: endpoint.address || '0.0.0.0',
            port: endpoint.port,
            routers: parseRouterNames(endpoint.routers)
        };
    };

    return HttpService;
}
