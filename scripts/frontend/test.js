const backendIp = "192.168.12.70";

class deviceDB {
	constructor() {
		this._boards = {};
		this._devices = {};
		this._bindings = {};
	}

	_onRequestError() {
		console.log("Failed to GET data");
	}

	_loadData(url) {
		return new Promise(function(resolve, reject) {
			var xhttp    = new XMLHttpRequest();

			xhttp.onload = function() {
				if(this.readyState == 4 && this.status == 200) {
					resolve(JSON.parse(this.responseText));
				} else {
					reject(this.statusText);
				}
			}

			xhttp.open("GET", url, true);
			xhttp.send();
		});
	}

	getDataDefinition(deviceId, peripheral) {
		var dataDef = null;
		var peripheral_data = this.getPeripheralData(deviceId, peripheral);

		try {
			dataDef = this._bindings[peripheral_data.compatible[0]].properties;
		} catch(error) {
			dataDef = this._bindings["nordic,nrf-uart"].properties;
		}

		return dataDef;
	}

	parseInstanceName(instance) {
		var number  = instance.substr(-1);
		var ofs     = 0;

		instance = instance.replace(':','');

		if(!([0,1,2,3,4,5,6,7,8,9].includes(parseInt(number)))) {
			number = -1;
		}

		if(instance[0] === '&') {
			ofs = 1;
		}

		if(number === -1) {
			var peripheral = instance.slice(ofs, instance.length);
		} else {
			var peripheral = instance.slice(ofs, -1);
		}
	
		return {'name'    :peripheral,
			'instance':number}
	}

	getLEDsData(boardId) {
		return this._boards[boardId].devicetree.leds;
	}

	getPeripheralData(deviceId, peripheral, boardId) {
		return this.getPeripheralsData(deviceId, boardId)[peripheral.name][peripheral.instance];

	}

	getPeripheralsData(deviceId, boardId) {
		var base_device   = this._devices[deviceId];
		var target_device = this._devices[this.getDeviceDependency(deviceId)];
		var merged_device = {};

		Object.keys(base_device).forEach(key => merged_device[key] = base_device[key]);
		Object.keys(target_device).forEach(key => merged_device[key] = target_device[key]);

		if(boardId != undefined) {
			var board = this._boards[boardId];

			Object.keys(board).forEach(key => {
				var peripheral = this.parseInstanceName(key);
				if((key[0] === '&') && (peripheral.name in merged_device.devicetree.soc)) {
					Object.keys(board[key]).forEach(attr => {
						if(peripheral.instance === -1) {
							merged_device.devicetree.soc[peripheral.name][0][attr] = board[key][attr];
						} else {
							merged_device.devicetree.soc[peripheral.name][peripheral.instance][attr] = board[key][attr];
						}

					});
				}
			});
		}

		return merged_device.devicetree.soc;
	}

	getDeviceDependency(id) {
		return this._devices[id].devicetree.dependency[0]
	}

	getBoardInterfaces(id) {
		var interfaces = {};

		Object.keys(this._boards[id]).forEach(intkey => {
			if(intkey[0] === "&") {
				var obj = this._boards[id][intkey];
				interfaces[intkey] = obj.constructor();
				for (var attr in obj) {
					if (obj.hasOwnProperty(attr)) interfaces[intkey][attr] = obj[attr];
				}
			}
		});

		return interfaces;
	}

	getBoardDevice(id) {
		return this._boards[id].devicetree.dependency[0];
	}

	getBoardModel(id) {
		return this._boards[id].devicetree.model[0];
	}

	getBoard(id) {
		return this._boards[id];
	}

	getBoards() {
		return this._boards;
	}

	loadDBs() {
		var promises = Array();

		promises.push(this._loadData("http://" + backendIp + ":5002/devices").then((result) => {
			this._devices = result;
		}));

		promises.push(this._loadData("http://" + backendIp + ":5002/boards").then((result) => {
			this._boards = result;
		}));

		promises.push(this._loadData("http://" + backendIp + ":5002/bindings").then((result) => {
			this._bindings = result;
		}));

		return promises;
	}
}

class state {
	constructor(db) {
		this._db = db;

		this._deviceId;
		this._boardId;

		this._data                            = {};
		this._data['dts_overlay']             = {};
		this._data.dts_overlay['peripherals'] = {};
	}

	set device(deviceId) {
		this._deviceId = deviceId;
	}

	get device() {
		return this._deviceId;
	}

	set board(boardId) {
		this._boardId = boardId;
	}

	get board() {
		return this._boardId;
	}

	generateDTS() {
		var output = document.getElementById("output");
		var template = [
			'{{#each @root.dts_overlay.peripherals }}',
			'&{{ @key }} {\n',
			'{{#each @root.dts_overlay.peripherals.@key }}',
			'	{{#js_if \"this.type === \'int\' || this.type === \'array\'\"}}',
			'	{{#js_if \"this.type === \'int\'\"}}{{ @key }}=<{{ this.value }}>;',
			'	{{ else }}{{ @key }}=<{{ join this.value delimiter=" " }}>;',
			'	{{/js_if}}',
			'	{{ else }}{{ @key }}="{{ this.value }}";',
			'	{{/js_if}}\n',
			'{{/each}}',
			'};\n\n',
			'{{/each}}'].join('');

		var compiled = Template7.compile(template);
		var generated = compiled(this._data);

		return generated;
		}

	peripheralPropExist(peripheral, prop) {
		if (this._data.dts_overlay.peripherals[peripheral.name + peripheral.instance] === undefined) {
			return false;
		}

		if (this._data.dts_overlay.peripherals[peripheral.name + peripheral.instance][prop]) {
			return true;
		} else {
			return false;
		}
	}

	getPeripheralProp(peripheral, prop) {
		return this._data.dts_overlay.peripherals[peripheral.name + peripheral.instance][prop];
	}

	storeLedValue(ledId, valueType, value) {
	}

	storeValue(deviceId, peripheral, parameterId, value) {
		var dataDef = this._db.getDataDefinition(deviceId, peripheral);

		if (!(parameterId in dataDef)) {
			console.log("Non-valid dataparameter");
			return;
		}

		if (!(peripheral.name+peripheral.instance in this._data.dts_overlay.peripherals)) {
			this._data.dts_overlay.peripherals[peripheral.name + peripheral.instance] = {};
		}

		this._data.dts_overlay.peripherals[peripheral.name + peripheral.instance][parameterId];

		if (dataDef[parameterId].type == "int") {
			this._data.dts_overlay.peripherals[peripheral.name + peripheral.instance][parameterId] = {"value":parseInt(value),
				                                                                                  "type":"int"};
		} else if (dataDef[parameterId].type == "string") {
			this._data.dts_overlay.peripherals[peripheral.name + peripheral.instance][parameterId] = {"value": value,
				                                                                                  "type" : "string"};
		} else if (dataDef[parameterId].type == "array") {
			var newArray = value.split(" ");
			this._data.dts_overlay.peripherals[peripheral.name + peripheral.instance][parameterId] = {"value": newArray,
				             									  "type" : "array"};
		} else if (dataDef[parameterId].type == undefined) {
			this._data.dts_overlay.peripherals[peripheral.name + peripheral.instance][parameterId] = {"value": value,
														  "type": "undefined"};
		}
	}

}

class boardSelectDialog {
	constructor(db, state) {
		this.modal = document.querySelector(".modal");
		this.trigger = document.querySelector(".trigger");
		this.closeButton = document.querySelector(".close-button");
	}

	toggleModal() {
		this.modal.classList.toggle("show-modal");
	}

	windowOnClick(event) {
		if (event.target === this.modal) {
			this.toggleModal();
		}
	}	
}

class APP {
	constructor(db, state) {
		this._outputElement         = document.getElementById("output");
		this._boardListElement      = document.getElementById("boardListElement");

		this._boardIdElement        = document.getElementById("boardIdElement");
		this._boardInfoElement      = document.getElementById("boardInfoElement");
		this._boardDeviceElement    = document.getElementById("boardDeviceElement");

		this._peripheralListElement = document.getElementById("peripheralListElement");
		this._selectedListElement   = document.getElementById("selectedListElement");
		this._peripheralProperties  = document.getElementById("peripheralPropertiesElement");

		this._ledTableElement       = document.getElementById("ledTableElement");

		this._selectedBoardElement  = document.getElementById("selectBoard");
		this._selectedPeripheral = "";

		this._db = db;
		this._state = state;

		this.boardSelect = new boardSelectDialog(this._db, this._state)
	}

	reset() {
		this._outputElement.value = "";

//		boardSelect.toggleModal();
	}

	populateBoardList() {
		var boards = this._db.getBoards();

		Object.keys(boards).forEach(board => {
			if (board.startsWith("nrf")) {
	   			var el = document.createElement('option');

				el.textContent = board;
				el.value = boards[board];
				this._boardListElement.appendChild(el);
			}
		});
	}

	selectInstance(index) {
		var newInstance = this._peripheralListElement[index].cloneNode(true);

		this._selectedListElement.appendChild(newInstance);
		this._peripheralListElement.removeChild(this._peripheralListElement[index]);
	}

	unselectInstance(index) {
		var newInstance = this._selectedListElement[index].cloneNode(true);

		this._peripheralListElement.appendChild(newInstance);
		this._selectedListElement.removeChild(this._selectedListElement[index]);
	}


	populatePeripheralList() {
		var length = this._selectedListElement.options.length;

		for (var i=length-1;i>=0;i--) {
			this._peripheralListElement.remove(i);
		}

		var peripherals = this._db.getPeripheralsData(this._state.device, this._state.board);

		Object.keys(peripherals).forEach(key => {
			for(var i=0;i<peripherals[key].length;++i) {
				var el = document.createElement('option');

				el.textContent = key + ":" + i;
				this._peripheralListElement.appendChild(el);
			}
  		});
	}

	storeNewLEDValue(e) {
		ledId = e.target.id.split("|")[0];
		valueType = e.target.id.split("|")[1];

		if ((valueType === 'port') || (valueType === 'pin')) {
			this._state.storeLedValue(ledId, valueType, e.traget.value); 
		} else {
			console.log("Unknown LED value type");
		}
	}

	populateLEDList() {
		var rowCount = this._ledTableElement.rows.length;

		console.log(rowCount);

		for(var i=0;i<rowCount;i++) {
			this._ledTableElement.deleteRow(i);
		}

		var leds  = this._db.getLEDsData(this._state.board);

		Object.keys(leds).forEach(led => {
				if (led !== 'compatible') {
				var newRow = this._ledTableElement.insertRow(0);

				var lableCell = newRow.insertCell(0);
				var lableInput = document.createElement("INPUT");
				lableInput.setAttribute("type","text");
				lableInput.setAttribute("readonly","");
				lableInput.value = led;
				lableCell.appendChild(lableInput);

				var portCell = newRow.insertCell(1);
				var portInput  = document.createElement("INPUT");
				portInput.setAttribute("type","text");
				portInput.setAttribute("id",led + "|port");
				portInput.value = leds[led][0].gpios[0];
				portInput.addEventListener("change", this.storeNewLEDValue.bind(this), false);
				portCell.appendChild(portInput);

				var pinCell = newRow.insertCell(2);
				var pinInput  = document.createElement("INPUT");
				pinInput.setAttribute("id",led + "|pin");
				pinInput.setAttribute("type","number");
				pinInput.setAttribute("min","0");
				pinInput.setAttribute("max","31");
				pinInput.value = leds[led][0].gpios[1];
				pinCell.appendChild(pinInput);

			}
		});
	}

	setBoardInterfaces() {
		var interfaces   = this._db.getBoardInterfaces(this._state.board);
		var list_options = this._peripheralListElement.options;

		for (var i=this._selectedListElement.options.length-1;i>=0;i--) {
			this._selectedListElement.remove(i);
		}

		Object.keys(interfaces).forEach(intface => {				
			var inst_number = this._db.parseInstanceName(intface).instance;
			var inst_name   = this._db.parseInstanceName(intface).name;
			var list_length  = this._peripheralListElement.options.length;

			for(var i=0;i<list_length;++i) {
				if(inst_number === -1) {
					if(list_options[i].textContent.localeCompare(inst_name+":0") === 0) {
						this.selectInstance(i);
						return;
					}
				} else {
					if(list_options[i].textContent.localeCompare(inst_name+":"+inst_number) === 0) {
						this.selectInstance(i);
						return;
					}
				}
			}
		});
	}

	addButton() {
		this.selectInstance(this._peripheralListElement.selectedIndex);
	}

	removeButton() {
		this.unselectInstance(this._selectedListElement.selectedIndex);
	}

	showBoardInfo() {
		this._state.board  = this._boardListElement[this._boardListElement.selectedIndex].text
		this._state.device = this._db.getBoardDevice(this._state.board);

		this._boardIdElement.textContent = this._state.board;
		this._boardInfoElement.textContent = this._db.getBoardModel(this._state.board);
		this._boardDeviceElement.textContent = this._state.device;

		this.populatePeripheralList();
		this.populateLEDList();
		this.setBoardInterfaces();
	}

	storeUpdatedValue(e) {
		var peripheral      = this._db.parseInstanceName(this._selectedPeripheral);
		var dataDef         = this._db.getDataDefinition(this._state.device, peripheral);
		var parameterId     = e.target.id;

		this._state.storeValue(this._state.device, peripheral, parameterId, e.target.value);
	
		this._outputElement.value = this._state.generateDTS();
	}

	showPeripheralInfo() {
		this._selectedPeripheral = this._selectedListElement[this._selectedListElement.selectedIndex].text
		var statuses             = document.getElementById("peripheral_status");
		var peripheral           = this._db.parseInstanceName(this._selectedPeripheral);
		var dataDef              = this._db.getDataDefinition(this._state.device, peripheral);
		var p_data               = this._db.getPeripheralData(this._state.device, peripheral, this._state.board);
	
		while (this._peripheralProperties.firstChild) {
			this._peripheralProperties.removeChild(this._peripheralProperties.firstChild);
		}	

		Object.keys(dataDef).forEach(prop => {
			this._peripheralProperties.appendChild(document.createTextNode(prop));
		
			var input_value;

			if (prop == "status") {
				input_value = document.createElement("SELECT");
				input_value.setAttribute("id",prop);
				var ok_option       = document.createElement('option');
				ok_option.textContent = 'ok';
				var disabled_option = document.createElement('option');
				disabled_option.textContent = 'disabled';
				input_value.appendChild(ok_option);
				input_value.appendChild(disabled_option);
			} else {
				input_value = document.createElement("INPUT");
				input_value.setAttribute("type","text");
				input_value.setAttribute("id",prop);
			}

			input_value.addEventListener("change", this.storeUpdatedValue.bind(this), false);
			this._peripheralProperties.appendChild(input_value);

			Object.keys(p_data).forEach(key => {
				if(key === prop) {
					if(!this._state.peripheralPropExist(peripheral, prop)) {
						input_value.value = p_data[key].join(' ');
					} else {
						console.log(this._state.getPeripheralProp(peripheral, prop).value);
						input_value.value = this._state.getPeripheralProp(peripheral, prop).value.join(' ');
					}
				}
			});

			this._peripheralProperties.appendChild(document.createElement("br"));
		});
	}
}

