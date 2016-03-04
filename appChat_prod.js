	var PORT = 8082;
	var authkey = '0e53dcde347ea1ba3bbf45d254ae421356ce0ed1';
	var apiHost = 'api.novp.com';
	var fsPath = '/home/ubuntu/nodejs/';
	
	var express = require('express');
	var app = express();
	var http = require('http');
	var server = http.createServer(app);
	var io = require('socket.io').listen(server);
	var url = require('url');
	var request = require('request');
	var querystring = require('querystring');
	var qs = require('qs');
	var bodyParser = require("body-parser");
	var fs = require('fs');
	var apn = require('apn');				

	server.listen(PORT);
	var mysql = require('mysql');
	var mysql_connection = mysql.createConnection(
	    {
	      host     : 'localhost',
	      user     : 'chat',
	      password : '49ZfdqFIDAcvz05',	      
	      database : 'chat',
	    }
	);
	mysql_connection.connect();
	
	var connections = {};
	
	var userId = false;
	var webId = false;
	var sessionId = false;
	var userConnect = false;
	var path = false;
	var users_registr = [];	
	var user_chatters = [];	

	var api = io.of('/api');
	var core = io.of('/general');

	var sockets = [];
	var room_prefix = "room#";
	var utoken = null;

	var general_users = {};

	var temp_api_boxes  = [];
	var api_rooms = {};
	var undoneThings = {invites:[], room_invites:[]};
	var syncedData = {};
	var userTimeSpending = 0;

	io.use(function(socket, next) {
		var userData = getActiveUser(socket.request);
		var global_user = getGlobalUserData(socket.request);
		var global_api_user = getAPIToken(socket.request);
		if(global_user.path){		
			userId = global_user.user_id;
			path = global_user.path;				
			return next();		
		}else if(global_api_user.token){
			utoken = global_api_user.token;
			return next();		
		}else{
			return next();		
		}
	});
	
	app.use('/static', express.static(__dirname + '/static'));
	app.use(bodyParser.urlencoded({ extended: false }));
	

	var count_box_posts = function(mysql_connection, res){
		mysql_connection.query("SELECT path, count(`id`) as count FROM `location_chat` GROUP BY `path`", function(err, results){
			if(!err)
				res.status(200).send({status:1, counts:results});	
			else
				res.status(400).send({status:0, description:"DataBase error!"});	
		});		
	}

	var wc_post_status_apn = function(mysql_connection, req, res){
		var config = {apn_cert:req.body.apn_cert, apn_key:req.body.apn_key, apn_pass:req.body.apn_pass};
		var devices = req.body.devices;
		devices = devices.split(",");

		if(config.apn_cert === undefined || config.apn_key === undefined || config.apn_pass === undefined)
				return false;
       	var cert = fsPath + "ios_certs/"+config.apn_cert;
       	var key = fsPath + "ios_certs/"+config.apn_key;
       	var pass = config.apn_pass;       	
       	var options = {
   			"cert" : cert,
		    "key"  : key,
   			"passphrase" : pass,
   			"production" : true
		};
		var message = req.body.sender_name + " send post status.";
		if(req.body.message !== undefined)
			message = message + " " + req.body.message;

		var wc_data = {sender_name:req.body.sender_name, status_id:req.body.status_id};

		for(var d=0;d<devices.length;d++){
			var device = devices[d];
			var apnConnection = new apn.Connection(options);
			var myDevice = new apn.Device(device);
			var note = new apn.Notification();
			note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
			note.badge = 3;			
			note.alert = message;
			note.payload = {'wc_data': JSON.stringify(wc_data)};			
			apnConnection.pushNotification(note, myDevice);
		}
		res.status(200).send();	
		
	}

	var webApiMethods = {
		"count_box_posts" :  count_box_posts,
		"wc_post_status_apn" : wc_post_status_apn
	};
	
	app.get('/webapi/:method/:id', function(req, res){	
		var params = req.params;	
		if(params.method === undefined)
			res.status(400).send({status:0, description:"Method requires!"});	
		
		if(webApiMethods[params.method] === undefined)
			res.status(400).send({status:0, description:"Undefined Method!"});	
		else
			webApiMethods[params.method](mysql_connection, res);
	});

	app.post('/webapi/:method/', function(req, res){	
		var params = req.params;	
		if(params.method === undefined)
			res.status(400).send({status:0, description:"Method requires!"});	
		
		if(webApiMethods[params.method] === undefined)
			res.status(400).send({status:0, description:"Undefined Method!"});	
		else
			webApiMethods[params.method](mysql_connection, req, res);
	});

	app.get('/', function(req, res) {
	    res.sendfile(__dirname + '/index.html');
	});
	
	io.on('connection', function(socket){
		socket.on("stream_event", function(data){
			io.emit("stream_event", data);
		});
	});

	// Chat API
	api.on('connection', function(socket){		
		// Notification room				
		var url_parts = url.parse(socket.handshake.url, true);
		var token = url_parts.query.token;
		
		socket.getUserRooms = function(){
			var rooms = [];
			
			if(typeof socket.session != "undefined" && 
				typeof socket.session.user_data != "undefined" && 
					typeof socket.session.user_data.rooms != "undefined"
			)
			{
				return socket.session.user_data.rooms;
			}
				
			return rooms;
		};
		
		if(token == undefined){
			return false;
		}
		var name = null;				
		// Check Token
		check_token(token);					
		

		function check_token(t){
				var options = {
					host: apiHost,
					path: "/app/api?method=getUserInfo&token="+t
				};

				callback = function(response){
					var output = "";					

					response.on('data', function(piece){
						output += piece;
					});

					response.on('end', function(){
						try{
							output = JSON.parse(output);						
						}catch(e){
							socket.emit('api_response', {status:'0', description: "User doesn't exist. Acces denied"});
							console.log(output);
							socket.emit('notifications', {request_type:'operation', status:'0', description: "User doesn't exist or unncorrect token. Acces denied"});				
							socket.disconnect('Unauthorized');
							return;							
						}						
						
						if(output.id == undefined){
							socket.emit('api_response', {status:'0', description: "User doesn't exist. Acces denied"});	
							socket.emit('notifications', {request_type:'operation', status:'0', description: "User doesn't exist or unncorrect token. Acces denied"});																	
							socket.disconnect('Unauthorized');
							return;
						}else{
							var uid = output.id;
							name = output.name;							
							var avatar = output.avatar;
							if(token !== undefined){
								socket.join(room_prefix+token);
							}
							handleSession(uid,name,avatar, writeToSession)
						}													
					});
					
					
				}

				http.request(options, callback).end();				
			}

			function handleSession(uid,name,avatar, callback){
				mysql_connection.query("select * from user_data where user_id = '"+uid+"' limit 1", function(err,res){
					if(err){
						callback(uid,name,avatar,false);
						return false;
					}
					callback(uid,name,avatar,res[0]);
				});
			}

			
			function writeToSession(uid, name, avatar, udata){
				var room = token;			
				var rooms = [];							
				var isExist = false;
				var existUser = null;

				var isDataSynced = false;
				if(udata !== undefined && udata.data !== undefined){	
					isDataSynced = true;					
					udata = JSON.parse(udata.data);
					rooms = udata.rooms;										
				}
				
				for(var i=0; i < sockets.length; i++){							
					if(sockets[i].session.user_data.uid == uid){												
						isExist = true;
						existUser = sockets[i].session.user_data;
					}
				}								
				
				if(!isExist && token !== undefined){
					if(typeof socket.session == "undefined")
						socket.session = {};
					//rooms.push(room);
					socket.session.user_data = {token:token, rooms:rooms, name:name, avatar:avatar, uid:uid, online:1};
					sockets.push(socket);					
				}
				else
				{					
					socket.session = {};
					socket.session.user_data = {};
					socket.session.user_data = existUser;
					socket.session.user_data.status = 1;
					socket.session.user_data.rooms = rooms;
					var updateOnlineStatus = function(i){
						if(i === null)
							return false;
						sockets[i].session.user_data.online = 1;
						sockets[i].session.user_data.token = token;
					}
					getSocketUser('uid',uid,updateOnlineStatus);
				}
									
				var user_data = {
					uid: socket.session.user_data.uid,
					name: socket.session.user_data.name,
					avatar: socket.session.user_data.avatar,
					rooms: []
				};	
				for(var i=0;i<socket.session.user_data.rooms.length;i++){					
					user_data.rooms.push(socket.session.user_data.rooms[i]);
				}

				api.to(room_prefix+token).emit('notifications', {request_type:'operation', request_method:'connection', status:'1', description:'User '+name+' has connected', user_data:user_data});
				
			}
		// END Notification room

        /* Find Socket Info  */
        function getSocketUser(type, val, callback){
        	var user = null;        	
        	for(var i=0;i<sockets.length;i++){
        		var udata = sockets[i].session.user_data;           		
        		if(udata[type] == val){
        			user = udata;
        			callback(i);
        			return true;
        		}
        	}  
        	callback(null);
        	return false;      	
        }
        /* END */

        function pushAPN(config){        	
			if(config.apn_cert === undefined || config.apn_key === undefined || config.apn_pass === undefined || config.device_token === undefined)
				return false;
        	var cert = fsPath + "ios_certs/"+config.apn_cert;
        	var key = fsPath + "ios_certs/"+config.apn_key;
        	var pass = config.apn_pass;
        	var token = config.device_token;
        	var options = {
    			"cert" : cert,
			    "key"  : key,
    			"passphrase" : pass,
    			"production" : true
			};
			var apnConnection = new apn.Connection(options);
			var myDevice = new apn.Device(token);
			var note = new apn.Notification();
			note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
			note.badge = 3;			
			note.alert = config.msg;
			note.payload = {'wc_data': JSON.stringify(config.wc_data)};			
			apnConnection.pushNotification(note, myDevice);
        }
        

		// Room connection handler
		socket.on('join_room', function(data){
			if(data.room === undefined){
				socket.emit('notifications', {request_type:'operation', status:'0', description: "Undefined room. Access denied"});				
				return;	
			}
			if(token === undefined){
				socket.emit('notifications', {request_type:'operation', status:'0', description: "Undefined token. Access denied"});				
				return;
			}

			var room = data.room;			
			var rooms = [];			
			var isExist = false;
			
			for(var i=0; i < sockets.length; i++){									
				if(sockets[i].session.user_data.token == token){					
					if(sockets[i].session.user_data.rooms.indexOf(room) == -1){
						sockets[i].session.user_data.rooms.push(room);	
						syncUserData(sockets[i].session.user_data.uid, "rooms", sockets[i].session.user_data.rooms);
						isExist = true;
					}else{
						isExist = true;
						continue;
					}
					
					isExist = true;
				}					
			}
							
				
			if(!isExist || token === undefined){
				api.to(room_prefix+token).emit('notifications', {request_type:'operation', status:'0', description:'User does not exist or undefined token. Acess Denied'});									
			}				
			
			join_to_room(room);	

			function join_to_room(room){				
				socket.join(room_prefix+room);				
				var udata = socket.session.user_data;
				if(udata.uid !== undefined)
					pushUidInRoom(room, udata.uid);								
				getRoomInfo(room, function(room_data) {
					sendGlobalNotification(room, 'user_login', {user_name:udata.name, user_id:udata.uid, room:room_data});
					// Sending last 5 messages					
					//getLastMessages(room);
				});				
			}
			
		});

		function getRoomInfo(room, callback){
			var room_info = {type:null, name:null, room_data:null};
			if(room.indexOf("->") != -1){
				var room_data = {name:null, users:[]};
				var uids = room.split("->");
				if(uids.length == 2)
					room_info.type = "personal";	
				else
					room_info.type = "group";	
				room_info.name = room;
				room_data.name = room;				
				room_data.users = uids;
				room_info.room_data = room_data;
				callback(room_info);
			}
			else if(room.indexOf("box_") != -1){
				var box_id = room.split("box_")[1];
				var room_data = {name:null, box_id:null, image:null,lat:null,lon:null,link:null};
				room_info.type = "box";		
				room_info.name = room;

				request.post({
					url: "http://"+apiHost + "/app/api",
					form: {method:"guest_get_boxbyid", secret:"9044583dSkTuhmn", params:{box_id:box_id}}
				}, function(err, resp, body){
					var res = JSON.parse(body);
					if(res.status == 1)
						room_info.room_data = res.box;
					callback(room_info);
				});

			}else{
				var room_data = {name:null, users:[]};				
				room_info.type = "general";	
				room_info.name = room;
				room_data.name = room;								
				room_info.room_data = room_data;
				callback(room_info);
			}
		}

		function addUserToRoom(room){			
			var rooms = [];			
			var isExist = false;
			
			for(var i=0; i < sockets.length; i++){									
				if(sockets[i].session.user_data.token == token){					
					if(sockets[i].session.user_data.rooms.indexOf(room) == -1){
						sockets[i].session.user_data.rooms.push(room);	
						syncUserData(sockets[i].session.user_data.uid, "rooms", sockets[i].session.user_data.rooms);
						isExist = true;
					}else{
						isExist = true;
						continue;
					}
					
					isExist = true;
				}					
			}

		}

		function syncUserData(uid, type, data){
			if(type == "rooms"){
				mysql_connection.query("select user_id, data from user_data where user_id='"+uid+"' limit 1", function(err, res){
					if(err)
						return false;
					if(res && res.length){						
						var entry = res[0].data;
						if(!entry.length)
							return false;
						entry = JSON.parse(entry);
						entry.rooms = data;
						entry = JSON.stringify(entry);
						mysql_connection.query("update user_data set data = '"+entry+"' where user_id='"+uid+"'", i_data);
						
					}else{
						var insertedData = {rooms:data};
						var convertedData = JSON.stringify(insertedData);
						var i_data = {user_id:uid, data:convertedData};
						mysql_connection.query("insert into user_data set ? ", i_data);
					}
				});
			}
		}
		

		function sendGlobalNotification(room, type, params){
			api.to(room_prefix+room).emit("notifications", {request_type:type, params:params});
		}

		function sortMessagesById(a, b){
			if(a.id > b.id) return 1;
			if(a.id < b.id) return -1;
			if(a.id == b.id) return 0;
		}

		function getLastMessages(room, offset, limit){			
				if(!offset)
					offset = 0;
				if(!limit)
					limit = 5;
				/*if(room.indexOf("box_") != -1 || room.indexOf("->") == -1){
					mysql_connection.query("select * from location_chat as chat where chat.path='"+room+"' order by date limit "+offset+","+limit, function(err, messages){
						if(!err){												
							socket.emit('get_messages', messages.sort(sortMessagesById));	
							return true;
						}	
					});
					return true;
				}*/
				var where = room;
				if(room.indexOf("->") != -1)
					where = "im"+room;
				
					mysql_connection.query("select * from message as m inner join message_send as ms on m.id=ms.msg_id where m.entry='im"+room+"' and ms.isSender='1' order by date limit "+offset+","+limit, function(err, messages){
						if(!err){
							var msgs = [];
							if(!messages)
								var messages = [];

							for(var i=0;i<messages.length;i++){
								var m = messages[i];
								var msg = {id:null,name:null,avatar:null,uid:null,path:null,msg:null,date:null,cacheKey:null};
								msg.id = m.msg_id;
								msg.name = m.uname;
								msg.avatar = m.uavatar;
								msg.uid = m.uid;
								msg.path = m.entry.replace("im", "");
								msg.msg = m.msg;
								msg.date = m.date;
								msg.cacheKey = m.cacheKey;
								msgs.push(msg);
							}							
							socket.emit('get_messages', msgs.sort(sortMessagesById));	
						}								
					});
				
				return true;

				/** Old API CHAT **/
				/*mysql_connection.query("select * from location_chat where path='"+room+"' order by date desc, id desc limit "+offset+","+limit, function(err, msgs){
					if(!err){						
						socket.emit('get_messages', msgs.reverse());
					}
				});	*/

		}

		socket.on('triggerRoomHistory', function(data){
			var offset = data.offset;
			var limit = data.limit;
			var room = data.room;
			if(room === undefined){
				socket.emit('notifications', {request_type:'error', status:'0', description: "Undefined room"});				
				return false;
			}
			if(offset === undefined)
				offset = 0;
			if(limit === undefined)
				limit = 5;
			getLastMessages(room, offset, limit);
		});

		socket.on('send_message', function(data) {
			if(data.room == undefined || data.msg == undefined){
				socket.emit('notifications', {request_type:'operation', status:'0', description: "Empty room or message. Access denied"});				
				return;	
			}else{
				var user_data = null;				
				var msg = data.msg;
				var room = data.room;
				var cacheKey = data.cacheKey;
				if(cacheKey === undefined)
					cacheKey = hashCode(makeid() + makeid());
				
				for(var i=0; i < sockets.length; i++){
					if(sockets[i].session.user_data.token == token){					
						user_data = sockets[i].session.user_data;
					}
				}

				var r_uids = decodeRoomName(room);

				var offliners = findOfflineInRoom(room, r_uids);				
				
				for(var i=0;i<offliners.length;i++){
					var offlineUser = offliners[i];
					var user_id = offlineUser.uid;
					var wc_data = {room:room, sender_id:user_data.uid};
					sendPushNotification(user_data.uid, user_id, "You've received message from "+user_data.name, wc_data);
					socket.emit('notifications', {request_type:'operation', status:'0', description: "Push Notification was send to offline user "+offlineUser.name});				
				}

				if(user_data == null){
					socket.emit('notifications', {request_type:'operation', status:'0', description: "No user was found for this room. Access denied"});				
					return;		
				}else{
					if(user_data.rooms.indexOf(room) == -1){
						socket.emit('notifications', {request_type:'operation', status:'0', description: "No user was found for this room. Access denied"});				
						return;			
					}else{
						// Write to BD						
						var sendBack = function(api, room_prefix, data, user_data, msg_id, cacheKey){
							var date = new Date();
							api.to(room_prefix+data.room).emit('get_messages', [{name:user_data.name, avatar:user_data.avatar, uid:user_data.uid, msg:data.msg, room:room, id:msg_id, date:date, cacheKey:cacheKey}]);
						}
						var sendToApp = function(message){							
							io.of("/general").emit("send_lhs_message", message);
							var date = new Date();
							var room = message.entry.replace("im", "");
							api.to(room_prefix+room).emit("get_messages", [{name:message.sender.uname, avatar:message.sender.uavatar, uid:message.sender.uid, msg:message.msg, room:room, id:message.id, date:date, cacheKey:message.cacheKey}]);
						}
						
						//writeLocationMsgToBd(mysql_connection, user_data.name, user_data.avatar, user_data.uid, msg, room, sendBack, api, room_prefix, data, user_data, cacheKey);	
						
						sendLHSMsgToAppApi(mysql_connection, user_data.name, user_data.avatar, user_data.uid, msg, room, sendToApp, api, room_prefix, data, user_data, cacheKey);
						
						// Emit it in room						
					}
				}				
			}			
		});

		function decodeRoomName(room){
			var uids = [];
			if(room.indexOf("->") != -1){
				uids = room.split("->");
			}
			return uids;
		}

		function getUserObject(){
			var user = {
				uid: null,
				uname: null,
				uavatar: null
			};
			return user;
		}

		function sendLHSMsgToAppApi(mysql,uname,uavatar,uid,msg,room,callback,api,room_prefix,data,user_data,cacheKey){			
			
			var message = {
			message:{
				type:"im",
				entry: "im"+room,
				sender: null,
				subject: null,
				recievers: [],
				ataches: [],
				vms: [],
				msg: msg
			},
				sender_id:uid
			};
			var user = getUserObject();
			user.uid = uid;
			user.uname = uname;
			user.uavatar = uavatar;
			message.message.sender = user;

			
			if(room.indexOf("->") != -1)
			{	
				var ids = room.split("->");
				ids = ids.sort(sortFunction);
				var s_index = ids.indexOf(''+uid);
				var reciever_id = null;
				for(var i=0;i<ids.length;i++){
					if(i != s_index){
						var reciever = getUserObject();
						var foundUser = findUser(reciever_id);
						reciever_id = ids[i];
						reciever.uid = reciever_id;
						reciever.uname = null;
						reciever.uavatar = null;			
						if(foundUser && foundUser.name && foundUser.avatar){
							reciever.uname = foundUser.name;
							reciever.uavatar = foundUser.avatar;			
						}			
						message.message.recievers.push(reciever);
					}
				}
			}else{
				message.message.recievers = [];
			}

			var message = message.message;
			var sender_id = data.sender_id;
			io.of("/general").emit("takeNextMessageWithEntry"+message.entry, {msg:message, entry:message.entry});
			io.of("/general").emit("someone_send_im_msg", {entry:message.entry, sender_id:sender_id, savatar:message.sender.uavatar, msg:message.msg, sname:message.sender.uname});
			if(message === undefined)
				return false;
			if(!cacheKey)
				cacheKey = hashCode(makeid() + makeid());

			var m = {entry:message.entry, msg:message.msg, cacheKey:cacheKey};				
			
			//io.of('/api').to(room_prefix+message.entry.replace("im","")).emit('get_messages', [{id:message.id, avatar:message.sender.uavatar, name:message.sender.uname, msg:message.msg, path:message.entry.replace("im",""), uid:sender_id, cacheKey:m.cacheKey, date:new Date()}]);
			mysql_connection.query('insert into message set ?', m, function(err, result){
				if(result.affectedRows !== undefined){					
					var msg_id = result.insertId;
					var values = [];
					var recievers_ids = [];
					message.id = msg_id;
					message.cacheKey = cacheKey;
					
					callback(message);

					values.push([msg_id, message.sender.uid, message.sender.uname, message.sender.uavatar, 1]);
					//console.log(values);
					for(var i=0;i<message.recievers.length;i++){
						var r = message.recievers[i];
						if(r.uavatar !== null){
							var uavatar = r.uavatar;
							var host = socket.handshake.headers.referer;
							host = rtrim(host, '/');
							if(uavatar.indexOf('https') == -1 && uavatar.indexOf('http') == -1){
								uavatar = origin + uavatar;
							}
						}

						values.push([msg_id, r.uid, r.uname, uavatar, 0]);
						recievers_ids.push(r.uid);
					}
					recievers_ids.push(message.sender.uid);
					recievers_ids.sort(sortFunction);
					
					//console.log(values);
					mysql_connection.query("insert into message_send (msg_id, uid, uname, uavatar, isSender) values ? ", [values], function(err, result){
						if (err) throw err;
					});
					if(message.ataches.length){
						var ataches = message.ataches;
						var ataches_values = [];
						for(var h=0;h<ataches.length;h++){
							var f = ataches[h];	
							ataches_values.push([msg_id, f.type, f.id, f.aws]);							
						}
						mysql_connection.query("insert into message_ataches (msg_id, type, cid, aws) values ? ", [ataches_values], function(err, result){
							if (err) throw err;
						});
					}
					if(!message.vms.length)
						return false;
					var vm_values = [];
					for(var j=0;j<message.vms.length;j++){
						var vm = message.vms[j];
						var entity = "im" + recievers_ids.join('->');
						vm_values.push([entity, msg_id, message.sender.uid, vm.aws]);
					}
					mysql_connection.query("insert into message_videos (entity, msg_id, uid, aws) values ? ", [vm_values], function(err, result){
						if (err) throw err;
					});
				}
			});
		}

		function rtrim ( str, charlist ) {

			charlist = !charlist ? ' \s\xA0' : charlist.replace(/([\[\]\(\)\.\?\/\*\{\}\+\$\^\:])/g, '\$1');
			var re = new RegExp('[' + charlist + ']+$', 'g');
			return str.replace(re, '');

		}

		var sortFunction = function(a, b){
				if(a < b) return 1;
				if(a > b) return -1;
				if(a == b) return 0;
		}

		hashCode = function(str){
	        var hash = 0,
	            len = str.length;
	    
	        for (var i = 0; i < len; i++) {
	            hash = hash * 31 + str.charCodeAt(i);
	        }
	        return hash;
	    }

	    function makeid()
		{
		    var text = "";
		    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

		    for( var i=0; i < 5; i++ )
		        text += possible.charAt(Math.floor(Math.random() * possible.length));

		    return text;
		}

		function sendPushNotification(mid, uid, msg, wc_data){
				request.post({
					url: "http://"+apiHost+"/app/api",
					form: {method: "guest_sendPushNotification", secret:"9044583dSkTuhmn", params:{mid:mid, uid:uid, msg:msg, wc_data:wc_data}}
				}, function(err, resp, body){
					if(err){
						console.log(err);
						return false;
					}									
					var config = JSON.parse(body);					
					if(config.status != 1){												
						socket.emit('notifications', {request_type:'operation', status:'0', description: config.description});				
						return false;						
					}
					config.params.msg = msg;
					config.params.wc_data = wc_data;
					pushAPN(config.params);

				});
			}	

			function pushUidInRoom(room, uid){
				if(api_rooms[room] === undefined){
					api_rooms[room] = [];
					api_rooms[room].push(uid);
				}else{
					if(api_rooms[room].indexOf(uid) == -1)
						api_rooms[room].push(uid);
				}							
			}	

			function findOfflineInRoom(room, uids){
				var offliners = [];					
				if(api_rooms[room] === undefined)
					return false;
				var found_uids = [];				
				for(var i=0;i<api_rooms[room].length;i++){
					var uid = api_rooms[room][i];
					var user = findUser(uid);
					if(user){
						if(user.online == 0){
							offliners.push(user);
							found_uids.push(user.uid);
						}
					}
				}
				if(uids){
					for(var j=0;j<uids.length;j++){
						var id = uids[j];
						if(found_uids.indexOf(id) == -1){							
							if(id != socket.session.user_data.uid){
								var user = {uid:id};
								offliners.push(user);
								found_uids.push(id);
							}							
						}
					}
				}				
				return offliners;
			}

			function findUser(uid){
				for(var i=0; i < sockets.length; i++){
					var user = sockets[i].session.user_data;
					if(user.uid == uid){
						return user;
					}
				}
				return false;
			}
			

			function handleUndoneThings(type, status, params){
				/*** Actions: 0 - push;  1 - unpush ***/				
				if(status == "0"){
					insertUndoneThing(params.room, params);				
				}else{
					deleteUndoneThing(params.room, params);
				}
				
			}

			function insertUndoneThing(room, params, callback){	
			    var invite_id = hashCode(makeid() + makeid());							
				var undone_entry = {invite_id:invite_id, room:room, reciever:params.reciever};
				
				if(undoneThings["room_invites"][room] === undefined){
					undoneThings["room_invites"][room] = [];
					undoneThings["room_invites"][room].push({invite_id:invite_id, sender:params.sender, reciever:params.reciever});
				}else{
					var alreadyIn = false;
					for(var i=0;i<undoneThings["room_invites"][room].length;i++){
						if(undoneThings["room_invites"][room][i].reciever == params.reciever && undoneThings["room_invites"][room][i].sender == params.sender){
							alreadyIn = true;							
						}
					}
					if(!alreadyIn)
						undoneThings["room_invites"][room].push({invite_id:invite_id, sender:params.sender, reciever:params.reciever});
				}

				if(undoneThings["invites"][params.reciever] === undefined){
					undoneThings["invites"][params.reciever] = [];
					undoneThings["invites"][params.reciever].push(undone_entry);					
				}else{					
					var alreadyIn = false;
					for(var j=0;j<undoneThings["invites"][params.reciever].length;j++){
						if(undoneThings["invites"][params.reciever][j].room == room && undoneThings["invites"][params.reciever][j].reciever == params.reciever)
							alreadyIn = true;
					}
					if(!alreadyIn)
						undoneThings["invites"][params.reciever].push(undone_entry);
				}

			}

			function deleteUndoneThing(room, params, callback){								
				if(undoneThings["room_invites"][room] !== undefined){
					for(var i=0;i<undoneThings["room_invites"][room].length;i++){
						if(undoneThings["room_invites"][room][i].reciever == params.reciever){
							var reciever = undoneThings["room_invites"][room][i].reciever;							
							if(undoneThings["invites"][reciever] !== undefined){
								for(var j = 0;j<undoneThings["invites"][reciever].length;j++){
									if(undoneThings["invites"][reciever][j].room == room && undoneThings["invites"][reciever][j].reciever == params.reciever){
										delete undoneThings["invites"][reciever][j];
										undoneThings["invites"][reciever].splice(j,1)
									}
								}			
							}							
							delete undoneThings["room_invites"][room][i];
							undoneThings["room_invites"][room].splice(i,1);
						}
					}
				}
			}		
			

		socket.on('triggerUndoneRequests', function(data){
			//console.log(undoneThings);			
			var user = socket.session.user_data;
			user.uid = parseInt(user.uid);
			
			if(undoneThings["invites"][user.uid] !== undefined){
				socket.emit('getUndoneRequests', undoneThings["invites"][user.uid]);
				socket.emit('notifications', {request_type:'undone_requests', params:{undone:undoneThings["invites"][user.uid]}});	
			}else{
				socket.emit('getUndoneRequests', []);
				socket.emit('notifications', {request_type:'undone_requests', params:{undone:[]}});	
			}
			
		});

		socket.on('invite_to_chat', function(data){
			// Find token for user id
			var sender = socket.session.user_data;
			var uids = [];
			var room = null;

			var sortFunction = function(a, b){
				if(a < b) return 1;
				if(a > b) return -1;
				if(a == b) return 0;
			}

			if(Object.prototype.toString.call( data.uid ) === '[object Array]'){				
				var uids = data.uid;
				uids.push(sender.uid);
				uids = uids.sort(sortFunction);
				room = uids.join('->');
			}else{
				var uids = [];
				uids.push(sender.uid);
				uids.push(data.uid);
				uids = uids.sort(sortFunction);
				room = uids.join('->');
			}
			for(var i=0;i<uids.length;i++){
				var invite_id = room;
				if(uids[i] != sender.uid){
					invite(uids[i], room, invite_id);
					handleUndoneThings('invites', 0, {room:room, sender:sender.uid, reciever:uids[i]});
				}				
			}

			api.to(room_prefix+sender.token).emit('notifications', {request_type:'invitation_send', status:'1', params:{room:room}});
			getLastMessages(room);

			function invite(uid, room, invite_id){
				var to_token = null;
				var to_name = null;	
				var from_name = null;		
				for(var i=0; i < sockets.length; i++){
					if(sockets[i].session.user_data.uid == uid){					
						to_token = sockets[i].session.user_data.token;
						to_name = sockets[i].session.user_data.name;					
						break;
					}
				}

				// Find who send invite
				for(var i=0; i < sockets.length; i++){
					if(sockets[i].session.user_data.token == token){										
						from_name = sockets[i].session.user_data.name;
						break;
					}
				}

				var wc_data = {room:room, sender_id:sender.uid, type:"invite"};
				sendPushNotification(sender.uid, uid, "You've received invitation to chat room - "+room+" from "+sender.name, wc_data);				
				
				if(to_token == null){					
					socket.join(room_prefix + room);
					addUserToRoom(room);					
					pushUidInRoom(room, sender.uid);
					socket.emit('notifications', {request_type:'operation', status:'0', description: "User doesn't exist or offline. Push Notification was send "});
				}else{	
					// Adding inviter to room
					socket.join(room_prefix + room);
					addUserToRoom(room);					
					pushUidInRoom(room, sender.uid);
					// END Adding inviter to room									
					// Send invitaion
					api.to(room_prefix+to_token).emit('notifications', {request_type:'invite', status:'1', description:'New invitation was send', name: from_name, room:room, invite_id:invite_id});								
				}
			}
			
		});

		socket.on('accept_invitaion', function(data){					
			if(data.room == undefined){
				socket.emit('notifications', {request_type:'operation', status:'0', description: "Undefined room. Acces denied"});
				return;
			}else{
				socket.join(room_prefix+data.room);
				addUserToRoom(data.room);					
				var udata = socket.session.user_data;
				var user_data = {name:udata.name, avatar:udata.avatar, online:udata.online, id:udata.uid};
				api.to(room_prefix+data.room).emit('notifications', {request_type:'accepted_invitation', params:{room:data.room, user_data:user_data}, status:'1', description: "User accepted invitation for chat"});	
				getRoomInfo(data.room, function(room_data){
					sendGlobalNotification(data.room, 'user_login', {user_name:user_data.name, user_id:user_data.uid, room:room_data});			
				});
				
				handleUndoneThings('invites', 1, {room:data.room, sender:null, reciever:udata.uid});	
				//getLastMessages(data.room);			
			}
		});

		socket.on('reject_invitation', function(data){
			var udata = socket.session.user_data;
			var user_data = {name:udata.name, avatar:udata.avatar, online:udata.online, id:udata.uid};
			api.to(room_prefix+data.room).emit('notifications', {request_type:'operation', params:{room:data.room, user_data:user_data}, status:'1', description: "User "+udata.name+" rejected invitation for chat"});				
			handleUndoneThings('invites', 1, {room:data.room, sender:null, reciever:udata.uid} );				
		});

		socket.on('get_room_users', function(data){
			if(data.room !== undefined){
				var users = findUsersByRoom(data.room);
				if(users){
					socket.emit('notifications', {request_type:'users_in_room', status:'1', description:'Users in room '+data.room, users:users, room:data.room});
				}
			}
		});

		socket.on('count_room_records', function(data){
			if(data.room !== undefined){				
				// Count Msgs
				mysql_connection.query("select count(id) as count from location_chat where path='"+data.room+"' ", function(err, count){
					if(!err){
						socket.emit('notifications', {request_type:'room_records', status:'1', description:'Records in room '+data.room, count:count.pop().count, room:data.room});																	
					}				
				});				
			}
		});

		socket.on('trigger_get_boxes', function(data){
			request.post({
				url: "http://"+apiHost + "/app/api",
				form: {method:"guest_get_boxes", secret:"9044583dSkTuhmn"}
			}, function(err, resp, body){
				try{
					var data = JSON.parse(body);
					var boxes = data.boxes;
					if(!boxes.length)
						return false;
					var rooms = [];
					for(var i=0; i<boxes.length;i++){
						var room = boxes[i].name;
						var users = findUsersByRoom(room);												
						rooms.push({room:room, users:users, count_users:users.length});												
					}
					getAllPostFromRoom(rooms, 0);						
					//console.log(rooms);
				}catch(e){
					console.log(e);
				}				
			});
		});
		
		socket.on('get_checkin_messages', function(data){
				if(typeof socket.session != "undefined")
				{
					var uid = socket.session.user_data.uid;
					var rooms = [];
					for(var i in sockets)
					{
						socket_one = sockets[i];
						
						if(typeof socket_one.session != "undefined" && 
							socket.session.user_data.uid == uid
						)
						{
							var socketRooms = socket_one.getUserRooms();
							for(var j in socketRooms)
							{
								
								if(rooms.indexOf(socketRooms[j]) == -1)
									rooms.push(socketRooms[j]);
							}
						}
						
						i++;
					}
				}
				
				var roomsStr = '';
				if(typeof rooms != "undefined")
				{
					var i=1;
					for(i=1;i<rooms.length;i++)
					{
						if(roomsStr != '') roomsStr += " , ";
						roomsStr += mysql_connection.escape(rooms[i]);
						i++;
					}
				}
				
				if(roomsStr == '')
				{
					socket.emit('notifications', {request_type:'checkin_messages', status:'0', description:'Last 10 messages from all checkin rooms'});
				}
				else
				{
					mysql_connection.query("select * from location_chat where path IN ("+roomsStr+") order by date desc, id desc limit 100 ", function(err, msgs){
						if(!err){
							socket.emit('notifications', {request_type:'checkin_messages', status:'1', description:'Last 10 messages from all checkin rooms', messages:msgs.reverse()});						
						}
						else
							socket.emit('notifications', {request_type:'checkin_messages', status:'0', description:'Last 10 messages from all checkin rooms'});
					});	
				}	
		});

		socket.on('disconnect', function(){
			// Find Socket
			var ud = null;
			for(var i=0; i < sockets.length; i++){
				if(sockets[i].session.user_data.token == token){					
					ud = sockets[i].session.user_data;
					break;
				}
			}
			if(ud != null){
				var uname = ud.name;
				var e_msg = {request_type:'operation', status:'1', description:'User '+uname+' is offline now'};			
				var place = 'notifications';
				tellAllMyRoom(ud.rooms, place, e_msg);
			}
			
			removeFromSocket(token);			
			
			// Clear from sockets			
		});

		function removeFromSocket(token){
			var el = null;
			for(var i=0; i < sockets.length; i++){
				if(sockets[i].session !== undefined){
					if(sockets[i].session.user_data.token == token){					
						sockets[i].session.user_data.online = 0;
					}
				}
			}

		}

		function getAllPostFromRoom(rooms, i){

			if(rooms[i] === undefined){				
				api.emit('get_boxes', {boxes:rooms});
				return false;
			}

			var room = rooms[i].room;
			mysql_connection.query('select * from location_chat where path="'+room+'" order by date desc', function(err,msgs){
				rooms[i].posts = msgs;
				rooms[i].count_posts = msgs.length;				
				getAllPostFromRoom(rooms, i+1);
			});		
			
		}

		function findSocketData(token){
			var socket_data = null;
			
			return socket_data;
		}

		function tellAllMyRoom(rooms, place, msg){
			for(var i=0; i<rooms.length; i++){
				api.to(room_prefix+rooms[i]).emit(place, msg);
			}
		}

		function findUsersByRoom(room){
			var users = [];

			for(var i=0; i < sockets.length; i++){
				var rooms = sockets[i].session.user_data.rooms;
				if(rooms.indexOf(room) != -1){
					var tmp = sockets[i].session.user_data;					
					users.push({name:tmp.name, avatar:tmp.avatar, uid:tmp.uid, online:tmp.online});
				}
			}

			return users;
		}
		

	});
	// END Chat API
	

	// General Chat
	core.on('connection', function(client) {	
		console.log('General connection');	
		
		client.on("stream_event", function(data){
			core.emit("stream_event", data);
		});
		
		if(path){
			var local_user_id = getGlobalUserData(client.request).user_id;	
			var host = getGlobalUserData(client.request).host;
			var origin_parts = client.request.headers.origin.split("/");
			var origin = origin_parts[0] + "//" + origin_parts[2];

			var events = 0;		

			console.log("User #"+local_user_id+ " has connected!");			

			if(general_users[local_user_id] !== undefined){
				general_users[local_user_id].online = 1;				
				general_users[local_user_id].sid = client.id;					
			}
			else{
				general_users[local_user_id] = {uid:local_user_id, sid:client.id, online:1, chaters:[], wait:[], call:[], camera:0};										
			}	

			getOnlineUsers(general_users, local_user_id, client, origin);
			
			// Camermens
			client.on("readyToGetCamermans", function() {				
				getLiveCameras(general_users, local_user_id, client, host);				
			});	

			// 1- start, 2- end
			timeCalculating(local_user_id, 1);

			client.on("user_offline", function(){								
				general_users[local_user_id].online = 0;
			});

			// Get lhs content
			client.on('get_lhs_content', function(data) {
				if(data.im !== undefined && data.im !== null){					
					get_lhs_content(local_user_id, client, data.im);
				}
				else
					get_lhs_content(local_user_id, client, null);
			});

			// Get IM all personal messages
			client.on('get_im_content', function() {				
				var sendImToClient = function(client, posts, mid){
					if(posts === undefined || !posts.length)
						client.emit('take_im_content', {status:0});
					else{						
						request.post({
							url: origin + "/app/api",
							form: {method:"getUserData", mid:mid, secret:"9044583dSkTuhmn"}
						}, function(err, resp, body){
							var user_data = null;
							try{
								user_data = JSON.parse(body);
							}catch(err){
								// No json format
							}
							client.emit('take_im_content', {status:1, posts:posts, user_data:user_data});
						});											
					}
					return false;
				};				
				
				mysql_connection.query("select msg_id from message_send where uid='"+local_user_id+"'", function(err, result) {
					if(!err){
						var mids = [];
						for(var i in result){
							mids.push(result[i].msg_id);
						}						

						mysql_connection.query("select m.id,m.entry,m.msg,m.date,ms.msg_id,ms.uid,ms.uname,ms.uavatar,ms.isSender,mv.entity,mv.aws from message as m inner join message_send as ms on m.id=ms.msg_id left join message_videos as mv on m.id=mv.msg_id where m.id in (?)", [mids], function(err, result){
							sendImToClient(client, result, local_user_id);
						});
						
					}
				});

			});

			core.emit('update_camermen', {uid:local_user_id, camera:0, online:1});

			core.emit('update_online_list', {mid:local_user_id});

			client.on('update_online_list', function(data){
				getOnlineUsers(general_users, local_user_id, client, host);				
			});	

			client.on('get_user_list', function(data){
				var sendUserList = function(client, users){
					client.emit('take_user_list', {users:users});
				}
				get_user_list(data, client, host, sendUserList);
			});

			// Find Chat Entity
			client.on("getChatEntry", function(data){
				var entry = data.entry;
				if(!entry)
					return false;
				mysql_connection.query("select m.id,m.entry,m.msg,m.date,ms.msg_id,ms.uid,ms.uname,ms.uavatar,ms.isSender,mv.entity,mv.aws from message as m inner join message_send as ms on m.id=ms.msg_id left join message_videos as mv on m.id=mv.msg_id where m.entry='"+entry+"' and ms.isSender=1 order by m.date desc limit 10", function(err, result){
					if(!err){						
						var msgs = result;						
						if(!msgs.length)
							return false;
						msgs.sort(function(a,b) { return a.date - b.date });
						var messages = [];
						var msgs_ids = [];
						for(var i=0;i<msgs.length;i++){
							var m = msgs[i];
							var msg = {mid:m.id,sender:{uid:m.uid, uname:m.uname, uavatar:m.uavatar}, msg:m.msg, vms:m.aws};
							messages.push(msg);
							msgs_ids.push(m.id);
						}

						function findAtaches(id, files){
							var ataches = [];
							for(var i=0;i<files.length;i++){
								var file = files[i];
								if(file.msg_id == id){
									ataches.push({msg_id:file.msg_id, type:file.type, cid:file.cid, aws:file.aws});
								}
							}
							return ataches;
						}

						mysql_connection.query("select * from message_ataches as ma where ma.msg_id in (?)", [msgs_ids], function(err, result){
							if(!err && result.length){								
								for(var g=0;g<messages.length;g++){
									var m = messages[g];
									m["ataches"] = findAtaches(m.mid, result);
								}								
							}
							client.emit("takeChatEntry", {msgs:messages});
						});						
						
					}else{
						console.log(err);
					}
				});
			});		

			client.on("send_email_msg", function(data){				
				core.emit("someone_send_email_msg", {entry:data.entry, sender_id:data.sender_id, savatar:data.message.sender.uavatar,msg:data.message.msg, sname:data.message.sender.uname});
			});

			// Take message from LHS Panel
			client.on("send_lhs_message", function(data) {
				console.log(data);
				var message = data.message;
				var sender_id = data.sender_id;
				core.emit("takeNextMessageWithEntry"+message.entry, {msg:message, entry:message.entry});
				core.emit("someone_send_im_msg", {entry:message.entry, sender_id:sender_id, savatar:message.sender.uavatar, msg:message.msg, sname:message.sender.uname});
				if(message === undefined)
					return false;
				var cacheKey = hashCode(makeid() + makeid());
				var m = {entry:message.entry, msg:message.msg, cacheKey:cacheKey};				
				
				io.of('/api').to(room_prefix+message.entry.replace("im","")).emit('get_messages', [{id:message.id, avatar:message.sender.uavatar, name:message.sender.uname, msg:message.msg, path:message.entry.replace("im",""), uid:sender_id, cacheKey:m.cacheKey, date:new Date()}]);
				mysql_connection.query('insert into message set ?', m, function(err, result){
					if(result.affectedRows !== undefined){
						var msg_id = result.insertId;
						var values = [];
						var recievers_ids = [];
						values.push([msg_id, message.sender.uid, message.sender.uname, message.sender.uavatar, 1]);
						
						for(var i=0;i<message.recievers.length;i++){
							var r = message.recievers[i];
							var uavatar = r.uavatar;
							var host = client.handshake.headers.referer;
							host = rtrim(host, '/');
							if(uavatar.indexOf('https') == -1 && uavatar.indexOf('http') == -1){
								uavatar = origin + uavatar;
							}
							
							values.push([msg_id, r.uid, r.uname, uavatar, 0]);
							recievers_ids.push(r.uid);
						}
						recievers_ids.push(message.sender.uid);
						recievers_ids.sort();
						mysql_connection.query("insert into message_send (msg_id, uid, uname, uavatar, isSender) values ? ", [values], function(err, result){
							if (err) throw err;
						});

						if(message.ataches.length){
							var ataches = message.ataches;
							var ataches_values = [];
							for(var h=0;h<ataches.length;h++){
								var f = ataches[h];	
								ataches_values.push([msg_id, f.type, f.id, f.aws]);							
							}
							mysql_connection.query("insert into message_ataches (msg_id, type, cid, aws) values ? ", [ataches_values], function(err, result){
								if (err) throw err;
							});
						}

						if(!message.vms.length)
							return false;
						var vm_values = [];
						for(var j=0;j<message.vms.length;j++){
							var vm = message.vms[j];
							var entity = "im" + recievers_ids.join('->');
							vm_values.push([entity, msg_id, message.sender.uid, vm.aws]);
						}
						mysql_connection.query("insert into message_videos (entity, msg_id, uid, aws) values ? ", [vm_values], function(err, result){
							if (err) throw err;
						});
					}
				});
			});

			function timeCalculating(uid, action){
				if(action == 1){
					userTimeSpending = Date.now();
				}else{
					var diff_secs = Date.now() - userTimeSpending;				
					request.post({
						url: origin + "/app/api",
						form: {method:"guest_setUserSpending", secret:"9044583dSkTuhmn", params:{uid:uid, spend:diff_secs}}
					}, function(err, resp, body){
						//
					});											
				}				
			}

			function rtrim ( str, charlist ) {

			    charlist = !charlist ? ' \s\xA0' : charlist.replace(/([\[\]\(\)\.\?\/\*\{\}\+\$\^\:])/g, '\$1');
			    var re = new RegExp('[' + charlist + ']+$', 'g');
			    return str.replace(re, '');

			}

			hashCode = function(str){
		        var hash = 0,
		            len = str.length;
		    
		        for (var i = 0; i < len; i++) {
		            hash = hash * 31 + str.charCodeAt(i);
		        }
		        return hash;
		    }

		    function makeid()
			{
			    var text = "";
			    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

			    for( var i=0; i < 5; i++ )
			        text += possible.charAt(Math.floor(Math.random() * possible.length));

			    return text;
			}

			// Say that I'm online to all from my Wait List			
			general_users = noticeFromMyWaitList(general_users, local_user_id, client);	
						
			// Get Busy status for all
			getBusyStatusForAll(client, mysql_connection);

			// Get availability
			getUserAvailableStatus(client, mysql_connection, local_user_id);	

			// Get recent global posts
			getRecentGlobalPosts(client, mysql_connection, 5);	
			// Get recent location posts
			getRecentLocationPosts(client, mysql_connection, 5, path);	
			// Get recent One to One posts
			client.on('get_recent_one_to_one_posts', function(req) {
				getRecentOneToOnePosts(client, mysql_connection, req.uid, req.tid, 5);	
			});		

			client.on('camera_on', function(data) {
				if(general_users[data.uid] === undefined)
					return false;

				general_users[data.uid].camera = 1;
				core.emit('update_camermen', {uid:local_user_id, camera:1, online:1});
			});

			client.on('camera_off', function(data){
				if(general_users[data.uid] === undefined)
					return false;

				general_users[data.uid].camera = 0;
				core.emit('update_camermen', {uid:local_user_id, camera:0, online:1});
			});
			

			client.on('start_invite', function(data){								
				var uid = data.uid;				
				uid = parseInt(uid);				
				general_users[local_user_id].call[uid] = uid;				

				if(general_users[uid] !== undefined){			
					if(general_users[uid].online == 1){												
						
						core.to(general_users[uid].sid).emit('chat_notification', {uid:local_user_id, msg:"wants to chat"});
						client.emit('chat_notification', {uid:uid, msg:"Logged In"});
						if(general_users[local_user_id].call[uid] !== undefined){							
							delete general_users[local_user_id].call[uid];
						}						
						
					}else		
						general_users[uid].wait[parseInt(local_user_id)];
				}else{
					general_users[uid] = {uid:uid, sid:'none', online:0, chaters:[], wait:[], call:[]};
					general_users[uid].wait[parseInt(local_user_id)];
				}
			});

			function get_user_list(data, client, host, callback){
				var mid = data.mid;
				if(mid === undefined || mid == null)
					return false;
				request.post({
					url: origin + "/app/api",
					form: {method: "getAllUserList", mid:mid, list:1}
				}, function(err, resp, body){
					callback(client, body);
				});
			}
			

			function get_lhs_content(mid, client, ims){
				if(mid === undefined)
					return false;

				request.post({
					url: origin +"/app/api",
					form: {method:"getLhsContent", mid:mid, ims:ims}
				}, function(err, resp, body){						
					try{						
						var data = JSON.parse(body);												
						if(data.status !== undefined){
							client.emit('take_lhs_content', {data:data});
						}
						else{
							client.emit('take_lhs_content', {data:{status:0, result: 'Unexpected error'}});
						}
					}catch(e){
						console.log(e);
						client.emit('take_lhs_content', {data:{status:0, result: 'Can not parse JSON'}});
					}					
				});		
			}			

			function getLiveCameras(general_users, local_user_id, client, host){
				var alertCamermenInfo = function(client, res_users, allUsers){
					var users = null;
					try {
					    users = JSON.parse(res_users);
					} catch (e) {						
					    return false;
					}
					users = users.users;

					for(var user in users){						
						var uid = user;
						
						if(allUsers[uid] === undefined){
							users[uid].online = 0;
							users[uid].camera = 0;
						}
						else{
							if(allUsers[uid].online == 0){
								users[uid].online = 0;
								users[uid].camera = 0;
							}
							else{
								users[uid].online = 1;
								if(allUsers[uid].camera == 1)
									users[uid].camera = 1;
								else
									users[uid].camera = 0;
							}
						}
					}
					
					client.emit('sendLiveCamermen', {users:users});
					return true;
				}
				getUsersFromMyList(general_users, local_user_id, client, origin, alertCamermenInfo);
			}


			function noticeFromMyWaitList(users, mid, client){
				
				if(users[mid].wait != null){					
					users[mid].wait.forEach(function(uuid){
						if(users[uuid] !== undefined){						
							if(users[uuid].online == 1){
								client.emit('chat_notification', {uid:uuid, msg:"wants to chat"});
								core.to(users[uuid].sid).emit('chat_notification', {uid:mid, msg:"Logged In"});														
								delete users[mid].call[uuid];
								delete users[uuid].wait[mid];								
							}
						}						
					});
				}
				return users;
			}
			
			
			// Listen for changing status event
			client.on('client_setAvailability', function(req) {
				var uid = req.id;
				var status = req.status;				
				addAvailableStatus(mysql_connection, uid, status);
			});

			// Listen for global inputs
			client.on('global_input', function(message) {
				var name = message.name;
				var avatar = message.avatar;
				var msg = message.global_message;
				var uid = message.uid;
				if(name && avatar && msg){
					writeMsgToBd(mysql_connection, name, avatar, uid, msg);
					core.emit('global_output',[message]);
				}
			});

			client.on('specific_input', function(message) {					
				var name = message.name;
				var avatar = message.avatar;
				var msg = message.msg;
				var uid = message.uid;
				if(name && avatar && msg){
					writeLocationMsgToBd(mysql_connection, name, avatar, uid, msg, path);
					core.emit('specific_output_'+path,[message]);
				}
			});

			client.on('one_to_one_input', function(message) {
				var name = message.name;
				var avatar = message.avatar;
				var msg = message.msg;
				var uid = message.uid;
				var tid = message.tid;
				var whom_id = null;
				var who_id = null;
				var now = new Date();				
				
				if(name && avatar && msg && tid && uid){
					writeOneToOneMsgToBd(mysql_connection, name, avatar, uid, tid, msg, path);					
					core.emit('one_to_one_output_'+uid, [message]);
					core.emit('one_to_one_output_'+tid, [message]);

					// Chaters active
					if(uid != local_user_id){
						whom_id = uid;
						who_id = tid;
					}
					else{
						whom_id = tid;
						who_id = uid;
					}					
					
					//user_chatters = addToChatters(user_chatters, userId, whom_id);
					//getRecentChatters(client, mysql_connection, userId, null);						
					//getRecentChatters(client, mysql_connection, tid, tid);										
					
				}
			});

		}else{
		
			client.join('room'+webId);	
			
			if(webId)
			{			
				mysql_connection.query('SELECT user FROM chat_messages WHERE webinar='+webId+' GROUP BY user', function(err, results) {
					if (!err)
					{
						var webinarChatUsersArr = {};
						
						var i=0;
						while(i in results)
						{
							var uid = results[i].user;
							webinarChatUsersArr[uid] = uid;
							i++;
						}
						
						
						
						var postData = qs.stringify({
							key: authkey,
							method: 'get_user_list_by_ids',
							params: {
								ids: webinarChatUsersArr
							}
						});
						
						var options = {
							hostname: apiHost,
							port: 80,
							path: '/api/user/',
							method: 'POST',
							headers: {
						        'Content-Type': 'application/x-www-form-urlencoded',
						        'Content-Length': postData.length
						    }
						};
						
						if(Object.keys(webinarChatUsersArr).length)
						{
							var req = http.request(options, function(res) {
					
								if(res.statusCode == 200)
								{
									res.setEncoding('utf8');
									res.on('data', function (chunk) {
										
										webinarChatUsersArr = {};
										
										try{
											chunkjson = JSON.parse(chunk);
											
											if(typeof chunkjson.result != "undefined")
											{
												var i=0;
												while(i in chunkjson.result)
												{
													var uId = chunkjson.result[i].id;
													webinarChatUsersArr[uId] = chunkjson.result[i];
													i++;
												}
											}
										} catch(e){console.log('json_error');}



											mysql_connection.query('SELECT user,webinar,message,UNIX_TIMESTAMP(time) as time FROM chat_messages WHERE webinar='+webId+' ORDER BY time', function(err, results) {
												if (!err)
												{
													var old_messages = [];
													var i=0;
													while(i in results)
													{
														var uId = results[i].user;
														var uData = {};
														if(typeof webinarChatUsersArr[uId] != "undefined")
														{
															uData = webinarChatUsersArr[uId];
														}
														else
															uData = uId;
														
														old_messages.push({
															'userdata':uData,
															'webinar':results[i].webinar,
															'message':results[i].message,
															'time':results[i].time
														});
														i++;
													}
													client.emit('message', {'message':old_messages});
												}
											});




									});
								}
								
							});
							req.on('error', function(e) {
							  console.log('problem with request: ' + e.message);
							});
							
							req.write(postData);
							req.end();
						}
						
					
					
					}
					
				});
				
				
				
				
			}
		}
		
		
		client.on('message', function(message) {
			console.log(message);
	        var userData = getActiveUser(client.request);
			try {
	            
	            var emitMessage = {};
				
				emitMessage.message = [{
				 	'userdata':{},
					'webinar':userData.webId,
					'message':message.message,
				 }];
				
				if((typeof connections[userData.webId] != "undefined") && (typeof connections[userData.webId][userData.userId] != "undefined"))
            	{
            		emitMessage.message[0].userdata = connections[userData.webId][userData.userId];
            	}
	            
	            client.emit('message', emitMessage);
	            client.broadcast.to('room'+userData.webId).emit('message', emitMessage);
	        	
	        	if(typeof message.message != "undefined")
	        	{
	        		mysql_connection.query('INSERT INTO chat_messages (user,webinar,message) VALUES ('+userData.userId+', '+userData.webId+','+mysql_connection.escape(message.message)+')');
				}
			
			} catch (e) {
	            console.log(e);
	            client.disconnect();
	        }
	    });

	    
	    client.on('disconnect', function () {		    	
	    	
		    var userData = getActiveUser(client.request);
		    var local_user_id = getGlobalUserData(client.request).user_id;		    
		    
		    if(general_users[local_user_id] !== undefined)
		    	general_users[local_user_id].online = 0;
		    
		    core.emit('disconnected_id', local_user_id);		    
		    console.log("User #"+local_user_id+ " has disconected!");

		    // 1- start, 2- end
		    timeCalculating(local_user_id, 2);	

		    if(general_users[local_user_id] !== undefined){
		    	general_users[local_user_id].camera = 0;
		    	core.emit('update_camermen', {uid:local_user_id, camera:0, online:0});
		    }	    		   

		});
		
	});

	function getUsersFromMyList(general_users, local_user_id, client, origin, callback){
		var uids = [];
		request.post({
			url: origin+"/app/api",
			form: {method:"getAllUserList", mid:local_user_id}
		}, function(err, resp, body){						
			callback(client, body, general_users);
		});
	}


	function getOnlineUsers(users, mid, core, origin){		
		var uids = [];				
		for(var user in users){ 			
			if(users[user].online == 1)
				uids.push(users[user].uid);	
		}				
		
		uids = JSON.stringify(uids);		

		var res = null;		

		request.post({
			url: origin+"/app/api",
			form: {method:"ifInUserList", uids:uids, mid:mid}			
		}, function(err, resp, body){
			setTimeout(function() {
				core.emit('check_online_users', {users:body, mid:mid});
			}, 1000);
			
		});	
	}


	function getUserAvailableStatus(client, mysql, id){
		mysql.query("select * from availability where uid="+id+" limit 1", function(err, info){
			if(!err){						
				client.emit('server_Availability', info);
			}
		});
	}

	function get_count_chatters(client, user_chatters){
		var count_chatters = 0;
		user_chatters.forEach(function(el) {
			count_chaters = count_chaters + 1;
		});
		client.emit('count_chaters', count_chatters);
	}

	function addToChatters(json, uid, wid){
		var now = new Date();
		var status = false;
		
		if(uid == wid){
			return;
		}

		if(json){
			json.forEach(function(el) {
			    if(el.tid == wid){		    	
			    	el.date = now;
			    	status = true;		    	
			    }
			});

			if(!status){
				json.push({'id': uid, 'tid': wid, 'date': now});
			}
		}else{
			json = [];
			json.push({'id': uid, 'tid': wid, 'date': now});
		}

		return json;
	}
	
	function getRecentChatters(client, mysql, id, wid){		
		mysql.query("select * from one_to_one_chat where uid="+id+" or tid="+id+" order by date desc", function(err, row){
			if(!err){
				if(row){
					var chatters = [];
					var chatters_id = [];
					row.forEach(function(el) {						
						if((new Date() - Date.parse(el.date)) < (15*60*1000)){
							var tid = null;
							if(el.uid == id)
								tid = el.tid;
							else
								tid = el.uid;
							
							if(chatters_id.indexOf(tid) == -1){
								chatters.push({'id':id, 'tid':tid, 'date':el.date});							
								chatters_id.push(tid);							
							}
							
						}
					});
					
					if(wid != null){
						io.sockets.emit('one_to_one_chaters_'+wid, chatters);
					}else{
						client.emit('get_chatters', chatters);	
					}	
				}
				
			}
		});		

	}

	function getBusyStatusForAll(client, mysql){
		mysql.query('select * from availability where status=2', function(err,users) {
			if(!err){
				client.emit('client_getUsersBusy', users);
			}
		});
	}

	function getOnlineStatus(client, mysql){
		mysql.query('select * from online_status where status=1', function(err,users) {
			if(!err){
				client.emit('check_online_status', users);
			}
		});
	}

	function addToOnlineStatus(mysql, id, val){		
		mysql.query('select * from online_status where uid='+id+' limit 1', function(err, user) {
			if(user != ""){
				mysql.query('update online_status set status='+val+' where uid='+id+' limit 1');				
			}else{
				mysql.query('insert into online_status (uid) values ("'+id+'")');
			}
		});
	}

	function addAvailableStatus(mysql, id, val){		
		mysql.query('select * from availability where uid='+id+' limit 1', function(err, user) {
			if(user != ""){
				mysql.query('update availability set status='+val+' where uid='+id+' limit 1');				
			}else{
				mysql.query('insert into availability (uid, status) values ("'+id+'", "'+val+'")');
			}
		});
	}
	
	function getRecentOneToOnePosts(client, mysql, uid, tid, limit){
		mysql.query('select * from one_to_one_chat where (uid="'+uid+'" and tid="'+tid+'") or (uid="'+tid+'" and tid="'+uid+'") order by date desc limit '+limit, function(err, msgs) {
			if(!err){				
				msgs = msgs.sort().reverse();
				client.emit('recent_one_to_one_msgs_'+uid, msgs);
			}
		});
	}

	function writeMsgToBd(mysql, name, avatar, uid, msg){		
		mysql.query('insert into global_chat (name, avatar, uid, global_message) VALUES ("'+name+'", "'+avatar+'", "'+uid+'", "'+msg+'")');
	}

	function writeLocationMsgToBd(mysql, name, avatar, uid, msg, path, sendBack, api, room_prefix, data, user_data, cacheKey){
		mysql.query('insert into location_chat (name, avatar, uid, path, msg, cacheKey) VALUES ("'+name+'", "'+avatar+'", "'+uid+'", "'+path+'", "'+msg+'", "'+cacheKey+'")', function(err, result) {
			if(!sendBack)
				return false;
			mysql.query('select max(id) as insertid from location_chat', function(err,result){
				if(!err){
					var id = null;
					if(result[0])
						id = result[0].insertid;								
					sendBack(api, room_prefix, data, user_data, id, cacheKey);
				}
				
			});			
		});
	}

	function writeOneToOneMsgToBd(mysql, name, avatar, uid, tid, msg, path){
		mysql.query('insert into one_to_one_chat (name, avatar, uid, tid, path, msg) VALUES ("'+name+'", "'+avatar+'", "'+uid+'", "'+tid+'", "'+path+'", "'+msg+'")');		
	}

	function getRecentGlobalPosts(client, mysql, limit){
		mysql.query('select * from global_chat order by date desc limit '+limit, function(err, msgs) {
			if(!err){
				msgs = msgs.sort().reverse();
				client.emit('recent_global_msgs', msgs);
			}
		});
	}

	function getRecentLocationPosts(client, mysql, limit, path){		
		mysql.query('select * from location_chat where path="'+path+'" order by date desc limit '+limit, function(err, msgs) {
			if(!err){		
				msgs = msgs.sort().reverse();					
				client.emit('recent_location_msgs_'+path, msgs);
			}else{
				console.log(err);
			}
		});
	}

	function getGlobalUserData(request){
		var res = {
			'user_id': 0,
			'path': false,
			'host':false
		}
		
		var url_parts = url.parse(request.url, true);
		res.user_id = parseInt(url_parts.query.user_id);
		res.path = url_parts.query.path;
		res.host = url_parts.query.host;
		
		return res;
	}

	function getAPIToken(request){
		var res = {
			token: null,			
		}
		
		var url_parts = url.parse(request.url, true);
		res.token = parseInt(url_parts.query.token);		
		
		return res;
	}
	
	function getActiveUser(handshakeData)
	{
		var res = {
			'userId':0,
			'webId':0,
			'sessionId':false
		}
		
		var url_parts = url.parse(handshakeData.url, true);
		var userId = parseInt(url_parts.query.user_id);
		var webId = parseInt(url_parts.query.webinar_id);
		if(userId) res.userId = userId;
		if(webId) res.webId = webId;
		res.sessionId = typeof url_parts.query.session_id != "undefined" ? url_parts.query.session_id : '';
		
		return res;
	}

	