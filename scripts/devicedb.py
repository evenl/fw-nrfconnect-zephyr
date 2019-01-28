import ntpath
import os
import json
import yaml
import sys
from io import StringIO
from operator import itemgetter
import re
from enum import Enum
from codegen.options import Options

from kconfig.kconfiglib import Kconfig, \
                               Symbol, Choice, \
                               BOOL, STRING, TRISTATE, TRI_TO_STR, MENU, COMMENT, INT, HEX, UNKNOWN, \
                               standard_kconfig, standard_config_filename, expr_value

from yamlinclude import YamlIncludeConstructor

# Capture our current directory
THIS_DIR = os.path.dirname(os.path.abspath(__file__))

class devicedb():

    def __init__(self):
        self.data = dict()
        self.boards = dict()
        self.devices = dict()
        self.samples = dict()
        self.config = dict()
        self.bindings = dict()
        self.yaml_files = dict()

        self.dts_includes = dict()

    def load_board_db(self, root_path):
        for subdir, dirs, files in os.walk(root_path+"boards/"):
            for file in files:
                board_name, file_ext = os.path.splitext(file)
                if file_ext == ".dts":
                    with open(subdir+"/"+file) as f:
                        data = dict()
                        data["devicetree"] = {}
                        data['devicetree']['dependency'] = []
                        self.parse_dts_file(f, data)
                        self.boards.update({board_name:dict()})
                        self.boards[board_name].update(data)


    def load_device_db(self, root_path):
        for subdir, dirs, files in os.walk(root_path+"dts/"):
            for file in files:
                device_name, file_ext = os.path.splitext(file)
                if file_ext == ".dtsi":
                    with open(subdir+"/"+file) as f:
                        data = dict()
                        data["devicetree"] = {}
                        data['devicetree']['dependency'] = []
                        self.parse_dts_file(f, data)
                        self.devices.update({device_name:dict()})

#                        self.devices[device_name].update({'id':device_name})
                        self.devices[device_name].update(data)

    def yaml_include(self, loader, node):
        with open(self.yaml_files[node.value]) as inputfile:
            return yaml.load(inputfile)

    def load_binding_db(self, root_path):
        yaml.add_constructor("!include", self.yaml_include)

        for subdir, dirs, files in os.walk(root_path+"dts/bindings/"):
            for file in files:
                device_name, file_ext = os.path.splitext(file)
                if file_ext == ".yaml":
                    self.yaml_files[file] = subdir+'/'+file

        for yamlfile in self.yaml_files:
            binding = yaml.load(open(self.yaml_files[yamlfile]))

            binding['properties']['status'] = {'type':'string','category':'required','description':'Device status'}

            self.bindings[yamlfile.replace('.yaml','')] = binding

    def load_samples_db(self, root_path):
        for subdir, dirs, files in os.walk(root_path+"samples/"):
            for file in files:
                device_name, file_ext = os.path.splitext(file)
                if file_ext == ".yaml":
                    with open(subdir+"/"+file) as f:
                        samples = yaml.load(f);
                        if 'sample' in samples and samples['sample']['name'] != 'TBD':
                            sample_name = samples['sample']['name']
                            self.samples.update({sample_name:dict()})
                            self.samples[sample_name].update({'path':subdir})

    def list_nodes(self, node, db, level):
        while node:
            if node.item == MENU:
                if node.list:
                    prompt, prompt_cond = node.prompt
                    db[prompt] = dict()
                    self.list_nodes(node.list, db[prompt], level+1)
            elif node.item == COMMENT:
                pass
            else:
                if node.item.visibility != 2:
                    node = node.next
                    continue
                if node.item.type is BOOL:
                    if node.item.name != None:
                        if node.item.tri_value == 2:
                            if node.list:
                                db[node.item.name] = dict()
                                self.list_nodes(node.list, db[node.item.name], level+1)
                            elif node.item.tri_value == 2:
                                db[node.item.name] = True
                        else:
                            db[node.item.name] = False

                elif node.item.type is STRING:
                    db[node.item.name] = node.item.str_value
                elif node.item.type is INT:
                    db[node.item.name] = node.item.str_value
                elif node.item.type is HEX:
                    db[node.item.name] = node.item.str_value

            node = node.next

    def load_kconfig_db(self, root_path):
        os.environ['srctree'] = root_path
        os.environ['KCONFIG_CONFIG'] = root_path + 'samples/hello_world/build/zephyr/.config'
        os.environ['BOARD_DIR'] = root_path + 'boards/arm/nrf52840_pca10056/'
        os.environ['ARCH'] = 'arm'
        os.environ['SOC_DIR'] = root_path + 'soc'
        kconf = Kconfig()
        kconf.load_config(root_path + 'samples/hello_world/build/zephyr/.config')
        node = kconf.top_node
        config = dict()
        self.list_nodes(node, config, 0);
        self.config = config

    def load_db(self, root_path):
        self.create_files_db(root_path+'dts/', '.h', self.dts_includes)
        self.create_files_db(root_path+'include/dt-bindings/', '.h', self.dts_includes)

        self.load_device_db(root_path)
        self.load_board_db(root_path)
        self.load_binding_db(root_path)
        self.load_samples_db(root_path)
#        self.load_kconfig_db(root_path)

    def get_boards(self):
        return self.boards

    def get_devices(self):
        return self.devices

    def get_samples(self):
        return self.samples

    def get_config(self):
        return self.config

    def get_bindings(self):
        return self.bindings

    def create_config_context(self):
        truefalse = {"y" : "true", "n" : "false"}
        self.data['config'] = dict()

        with open(self.data['runtime']['defines']['PROJECT_BINARY_DIR']+"/.config") as f:
            configlines = f.readlines()
            for confline in configlines:
                if not confline.startswith('#') and confline.strip():
                    config_item = confline.strip().split("=")

                    if len(config_item[1]) == 1:
                        if ("y" in config_item[1]) or ("n" in config_item[1]):
                            self.data['config'].update({config_item[0]:truefalse[config_item[1]]})
                        else:
                            self.data["config"].update({config_item[0]:config_item[1].strip()})
                    else:
                        self.data["config"].update({config_item[0]: config_item[1].strip().replace('"','')})

    def create_files_db(self, root_path, ext, db):
        for subdir, dirs, files in os.walk(root_path):
            for file in files:
                device_name, file_ext = os.path.splitext(file)
                if file_ext == ext:
                    db[file] = subdir+'/'+file

    def load_dts_headerfile(self, filename, data):
        with open(self.dts_includes[filename]) as f:
            lines = f.readlines()
            for line in lines:
                symbol = re.split('[ \t]', line, 2)
                if symbol[0] == '#define' and len(symbol) > 2:
                   result = ""
                   symbol[2] = symbol[2].split("/*")[0]

                   try:
                      result = eval(symbol[2].strip())
                   except:
                      for k,v in data.items():
                         if str(k) in symbol[2]:
                             try:
                                 result = eval(symbol[2].replace(str(k), str(v)))
                             except:
                                 result = ""
                             break

                      if result == "":
                         result = symbol[2].strip()

                   data[symbol[1].strip()] = result

    def parse_dts_file(self, file, data):
        for dtsline in file:
            if dtsline.startswith("#include"):
                include = re.search('<(.*)>', dtsline)
                if include != None and include.group(1).endswith(".dtsi"):
                  include = include.group(1).split('/')
                  data['devicetree']['dependency'].append(include[len(include)-1].replace('.dtsi',''))
                elif include != None and include.group(1).endswith(".h"):
                  if 'symbols' not in data:
                      data['symbols'] = dict()
                  symbol_file = include.group(1).split('/')
                  symbol_file = symbol_file[len(symbol_file)-1]
                  self.load_dts_headerfile(symbol_file, data['symbols'])

            if dtsline.startswith("/ {"):
                self.parse_dts_file(file, data["devicetree"])
                continue

            dtsline = dtsline.strip()
            line_array = re.split("=", dtsline)
            line_array = [element.strip() for element in line_array if element != '']

            if len(line_array) > 0:
                if line_array[-1].endswith("{"):
                    new_scope = line_array[0].split(" ")

                    if len(new_scope) == 3:
                        instance = new_scope[0].strip(":")
                        scope_key = new_scope[1].split("@")
                        key = scope_key[0]

                        if key not in data.keys():
                            data[key] = []

                        data[key].append({"instance":instance})
                        self.parse_dts_file(file, data[key][-1])
                        continue

                    new_key = line_array[0].split(" ")[0].strip()

                    if new_key not in data.keys():
                        data[new_key] = {}

                    self.parse_dts_file(file, data[new_key])
                    continue

                if line_array[-1] == "};":
                    return

                if len(line_array) == 2:
                    key = line_array[0]
                    value = line_array[1]

                    if value.endswith(">;") and value.startswith("<"):
                        array_string = value.strip(">;").strip("<")
                        data.update({key:array_string.split(" ")})
                        continue

                if len(line_array) > 1:
                    if isinstance(data, dict):
                        data.update({line_array[0]:line_array[1].split("\"")})

                        for i, val in enumerate(data[line_array[0]]):
                            entry = data[line_array[0]]
                            entry[i] = val.strip(' ",;')
                            if entry[i] == "":
                                del entry[i]


                    else:
                        data.append({line_array[0]:line_array[1]})

if __name__ == '__main__':

    ret = devicedb().load_db()

