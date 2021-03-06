var _ = require("lodash");
var path = require("path");
var express = require("express");
var bodyParser = require("body-parser");
var compiler = require("krl-compiler");
var version = require("../package.json").version;
var oauth_server = require("./oauth_server");

var mergeGetPost = function(req){
    //give preference to post body params
    return _.assign({}, req.query, req.body);
};

module.exports = function(pe){
    var logs = {};
    var logRID = "io.picolabs.logging";
    var logEntry = function(context,message){
        var eci = context.eci;
        var timestamp = (new Date()).toISOString();
        var episode = logs[eci];
        if (episode) {
            episode.logs.push(timestamp+" "+message);
        } else {
            console.log("[ERROR]","no episode found for",eci);
        }
    };
    var logEpisode = function(pico_id,context,callback){
        var eci = context.eci;
        var episode = logs[eci];
        if (!episode) {
            console.log("[ERROR]","no episode found for",eci);
            return;
        }
        pe.getEntVar(pico_id,logRID,"status",function(e,status){
            if (status) {
                pe.getEntVar(pico_id,logRID,"logs",function(e,data){
                    data[episode.key] = episode.logs;
                    pe.putEntVar(pico_id,logRID,"logs",data,function(e){
                        callback(delete logs[eci]);
                    });
                });
            } else {
                callback(delete logs[eci]);
            }
        });
    };
    pe.emitter.on("episode_start", function(context){
        console.log("EPISODE_START",context);
        var eci = context.eci;
        var timestamp = (new Date()).toISOString();
        var episode = logs[eci];
        if (episode) {
            console.log("[ERROR]","episode already exists for",eci);
        } else {
            episode = {};
            episode.key = (
                    timestamp + " - " + eci
                    + " - " + ((context.event) ? context.event.eid : "query")
                    ).replace(/[.]/g, "-");
            episode.logs = [];
            logs[eci] = episode;
        }
    });
    pe.emitter.on("klog", function(context, val, message){
        console.log("[KLOG]", message, val);
        logEntry(context,"[KLOG] "+message+" "+JSON.stringify(val));
    });
    pe.emitter.on("log-error", function(context_info, expression){
        console.log("[LOG-ERROR]",context_info,expression);
        logEntry(context_info,"[LOG-ERROR] "+JSON.stringify(expression));
    });
    pe.emitter.on("log-warn", function(context_info, expression){
        console.log("[LOG-WARN]",context_info,expression);
        logEntry(context_info,"[LOG-WARN] "+JSON.stringify(expression));
    });
    pe.emitter.on("log-info", function(context_info, expression){
        console.log("[LOG-INFO]",context_info,expression);
        logEntry(context_info,"[LOG-INFO] "+JSON.stringify(expression));
    });
    pe.emitter.on("log-debug", function(context_info, expression){
        console.log("[LOG-DEBUG]",context_info,expression);
        logEntry(context_info,"[LOG-DEBUG] "+JSON.stringify(expression));
    });
    pe.emitter.on("debug", function(context, message){
        console.log("[DEBUG]", context, message);
        logEntry(context,message);
    });
    pe.emitter.on("error", function(context, message){
        console.error("[ERROR]", context, message);
        logEntry(context,message);
    });
    pe.emitter.on("episode_stop", function(context){
        console.log("EPISODE_STOP",context);
        var callback = function(outcome){
            console.log("[EPISODE_REMOVED]",outcome);
        };
        logEpisode(context.pico_id,context,callback);
    });

    var app = express();
    app.use(function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
        next();
    });
    app.use(express.static(path.resolve(__dirname, "..", "public")));
    app.use(bodyParser.json({type: "application/json"}));
    app.use(bodyParser.urlencoded({limit: "512mb", type: "application/x-www-form-urlencoded", extended: false}));

    var errResp = function(res, err){
        res.status(err.statusCode || 500).json({error: err.message});
    };

    app.use(function(err, req, res, next){
        errResp(res, err);
    });
    app.use(function(req, res, next){ // needed by oauth_server
        req.pe = pe;
        req.errResp = errResp;
        next();
    });

    app.all("/sky/event/:eci/:eid/:domain/:type", function(req, res){
        var event = {
            eci: req.params.eci,
            eid: req.params.eid,
            domain: req.params.domain,
            type: req.params.type,
            attrs: mergeGetPost(req)
        };
        pe.signalEvent(event, function(err, response){
            if(err) return errResp(res, err);
            res.json(response);
        });
    });

    app.all("/sky/cloud/:eci/:rid/:function", function(req, res){
        var query = {
            eci: req.params.eci,
            rid: req.params.rid,
            name: req.params["function"],
            args: mergeGetPost(req)
        };
        pe.runQuery(query, function(err, data){
            if(err) return errResp(res, err);
            if(_.isFunction(data)){
                data(res);
            }else{
                res.json(data);
            }
        });
    });

    app.get("/authorize", oauth_server.authorize);

    app.post("/approve", oauth_server.approve);

    app.post("/token", oauth_server.token);

    app.all("/api/engine-version", function(req, res){
        res.json({"version": version});
    });

    app.all("/api/db-dump", function(req, res){
        pe.dbDump(function(err, db_data){
            if(err) return errResp(res, err);
            res.json(db_data);
        });
    });

    app.all("/api/owner-eci", function(req, res){
        pe.getOwnerECI(function(err, eci){
            if(err) return errResp(res, err);
            res.json({ok: true, eci: eci});
        });
    });

    app.all("/api/pico/:id/new-channel", function(req, res){
        var args = mergeGetPost(req);

        pe.newChannel({
            pico_id: req.params.id,
            name: args.name,
            type: args.type
        }, function(err, new_channel){
            if(err) return errResp(res, err);
            res.json(new_channel);
        });
    });

    app.all("/api/pico/:id/rm-channel/:eci", function(req, res){
        pe.removeChannel(req.params.id, req.params.eci, function(err){
            if(err) return errResp(res, err);
            res.json({ok: true});
        });
    });

    app.all("/api/pico/:id/rm-ruleset/:rid", function(req, res){
        pe.uninstallRuleset(req.params.id, req.params.rid, function(err){
            if(err) return errResp(res, err);
            res.json({ok: true});
        });
    });

    app.all("/api/pico/:id/rm-ent-var/:rid/:var_name", function(req, res){
        pe.removeEntVar(req.params.id, req.params.rid, req.params.var_name, function(err){
            if(err) return errResp(res, err);
            res.json({ok: true});
        });
    });

    app.all("/api/ruleset/compile", function(req, res){
        var args = mergeGetPost(req);

        try{
            res.json({ok: true, code: compiler(args.src).code});
        }catch(err){
            res.status(400).json({ error: err.toString() });
        }
    });

    app.all("/api/ruleset/register", function(req, res){
        var args = mergeGetPost(req);

        var onRegister = function(err, data){
            if(err) return errResp(res, err);
            res.json({ok: true, rid: data.rid, hash: data.hash});
        };
        if(_.isString(args.src)){
            pe.registerRuleset(args.src, {}, onRegister);
        }else if(_.isString(args.url)){
            pe.registerRulesetURL(args.url, onRegister);
        }else{
            errResp(res, new Error("expected `src` or `url`"));
        }
    });

    app.all("/api/ruleset/flush/:rid", function(req, res){
        pe.flushRuleset(req.params.rid, function(err, data){
            if(err) return errResp(res, err);
            console.log("Ruleset successfully flushed: " + data.rid);
            res.json({ok: true, rid: data.rid, hash: data.hash});
        });
    });

    app.all("/api/ruleset/unregister/:rid", function(req, res){
        pe.unregisterRuleset(req.params.rid, function(err){
            if(err) return errResp(res, err);
            res.json({ok: true});
        });
    });

    return app;
};
