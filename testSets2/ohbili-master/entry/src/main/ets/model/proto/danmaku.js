/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
import $protobuf from "@ohos/protobufjs";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const bilibili = $root.bilibili = (() => {

    /**
     * Namespace bilibili.
     * @exports bilibili
     * @namespace
     */
    const bilibili = {};

    bilibili.community = (function() {

        /**
         * Namespace community.
         * @memberof bilibili
         * @namespace
         */
        const community = {};

        community.service = (function() {

            /**
             * Namespace service.
             * @memberof bilibili.community
             * @namespace
             */
            const service = {};

            service.dm = (function() {

                /**
                 * Namespace dm.
                 * @memberof bilibili.community.service
                 * @namespace
                 */
                const dm = {};

                dm.v1 = (function() {

                    /**
                     * Namespace v1.
                     * @memberof bilibili.community.service.dm
                     * @namespace
                     */
                    const v1 = {};

                    v1.DmSegMobileReply = (function() {

                        /**
                         * Properties of a DmSegMobileReply.
                         * @memberof bilibili.community.service.dm.v1
                         * @interface IDmSegMobileReply
                         * @property {Array.<bilibili.community.service.dm.v1.IDanmakuElem>|null} [elems] DmSegMobileReply elems
                         * @property {number|null} [state] DmSegMobileReply state
                         * @property {bilibili.community.service.dm.v1.IDanmakuAIFlag|null} [aiFlag] DmSegMobileReply aiFlag
                         */

                        /**
                         * Constructs a new DmSegMobileReply.
                         * @memberof bilibili.community.service.dm.v1
                         * @classdesc Represents a DmSegMobileReply.
                         * @implements IDmSegMobileReply
                         * @constructor
                         * @param {bilibili.community.service.dm.v1.IDmSegMobileReply=} [properties] Properties to set
                         */
                        function DmSegMobileReply(properties) {
                            this.elems = [];
                            if (properties)
                                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                    if (properties[keys[i]] != null)
                                        this[keys[i]] = properties[keys[i]];
                        }

                        /**
                         * DmSegMobileReply elems.
                         * @member {Array.<bilibili.community.service.dm.v1.IDanmakuElem>} elems
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @instance
                         */
                        DmSegMobileReply.prototype.elems = $util.emptyArray;

                        /**
                         * DmSegMobileReply state.
                         * @member {number} state
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @instance
                         */
                        DmSegMobileReply.prototype.state = 0;

                        /**
                         * DmSegMobileReply aiFlag.
                         * @member {bilibili.community.service.dm.v1.IDanmakuAIFlag|null|undefined} aiFlag
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @instance
                         */
                        DmSegMobileReply.prototype.aiFlag = null;

                        /**
                         * Creates a new DmSegMobileReply instance using the specified properties.
                         * @function create
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @static
                         * @param {bilibili.community.service.dm.v1.IDmSegMobileReply=} [properties] Properties to set
                         * @returns {bilibili.community.service.dm.v1.DmSegMobileReply} DmSegMobileReply instance
                         */
                        DmSegMobileReply.create = function create(properties) {
                            return new DmSegMobileReply(properties);
                        };

                        /**
                         * Encodes the specified DmSegMobileReply message. Does not implicitly {@link bilibili.community.service.dm.v1.DmSegMobileReply.verify|verify} messages.
                         * @function encode
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @static
                         * @param {bilibili.community.service.dm.v1.IDmSegMobileReply} message DmSegMobileReply message or plain object to encode
                         * @param {$protobuf.Writer} [writer] Writer to encode to
                         * @returns {$protobuf.Writer} Writer
                         */
                        DmSegMobileReply.encode = function encode(message, writer) {
                            if (!writer)
                                writer = $Writer.create();
                            if (message.elems != null && message.elems.length)
                                for (let i = 0; i < message.elems.length; ++i)
                                    $root.bilibili.community.service.dm.v1.DanmakuElem.encode(message.elems[i], writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
                            if (message.state != null && Object.hasOwnProperty.call(message, "state"))
                                writer.uint32(/* id 2, wireType 0 =*/16).int32(message.state);
                            if (message.aiFlag != null && Object.hasOwnProperty.call(message, "aiFlag"))
                                $root.bilibili.community.service.dm.v1.DanmakuAIFlag.encode(message.aiFlag, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
                            return writer;
                        };

                        /**
                         * Encodes the specified DmSegMobileReply message, length delimited. Does not implicitly {@link bilibili.community.service.dm.v1.DmSegMobileReply.verify|verify} messages.
                         * @function encodeDelimited
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @static
                         * @param {bilibili.community.service.dm.v1.IDmSegMobileReply} message DmSegMobileReply message or plain object to encode
                         * @param {$protobuf.Writer} [writer] Writer to encode to
                         * @returns {$protobuf.Writer} Writer
                         */
                        DmSegMobileReply.encodeDelimited = function encodeDelimited(message, writer) {
                            return this.encode(message, writer).ldelim();
                        };

                        /**
                         * Decodes a DmSegMobileReply message from the specified reader or buffer.
                         * @function decode
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @static
                         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                         * @param {number} [length] Message length if known beforehand
                         * @returns {bilibili.community.service.dm.v1.DmSegMobileReply} DmSegMobileReply
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        DmSegMobileReply.decode = function decode(reader, length, error) {
                            if (!(reader instanceof $Reader))
                                reader = $Reader.create(reader);
                            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.bilibili.community.service.dm.v1.DmSegMobileReply();
                            while (reader.pos < end) {
                                let tag = reader.uint32();
                                if (tag === error)
                                    break;
                                switch (tag >>> 3) {
                                case 1: {
                                        if (!(message.elems && message.elems.length))
                                            message.elems = [];
                                        message.elems.push($root.bilibili.community.service.dm.v1.DanmakuElem.decode(reader, reader.uint32()));
                                        break;
                                    }
                                case 2: {
                                        message.state = reader.int32();
                                        break;
                                    }
                                case 3: {
                                        message.aiFlag = $root.bilibili.community.service.dm.v1.DanmakuAIFlag.decode(reader, reader.uint32());
                                        break;
                                    }
                                default:
                                    reader.skipType(tag & 7);
                                    break;
                                }
                            }
                            return message;
                        };

                        /**
                         * Decodes a DmSegMobileReply message from the specified reader or buffer, length delimited.
                         * @function decodeDelimited
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @static
                         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                         * @returns {bilibili.community.service.dm.v1.DmSegMobileReply} DmSegMobileReply
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        DmSegMobileReply.decodeDelimited = function decodeDelimited(reader) {
                            if (!(reader instanceof $Reader))
                                reader = new $Reader(reader);
                            return this.decode(reader, reader.uint32());
                        };

                        /**
                         * Verifies a DmSegMobileReply message.
                         * @function verify
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @static
                         * @param {Object.<string,*>} message Plain object to verify
                         * @returns {string|null} `null` if valid, otherwise the reason why it is not
                         */
                        DmSegMobileReply.verify = function verify(message) {
                            if (typeof message !== "object" || message === null)
                                return "object expected";
                            if (message.elems != null && message.hasOwnProperty("elems")) {
                                if (!Array.isArray(message.elems))
                                    return "elems: array expected";
                                for (let i = 0; i < message.elems.length; ++i) {
                                    let error = $root.bilibili.community.service.dm.v1.DanmakuElem.verify(message.elems[i]);
                                    if (error)
                                        return "elems." + error;
                                }
                            }
                            if (message.state != null && message.hasOwnProperty("state"))
                                if (!$util.isInteger(message.state))
                                    return "state: integer expected";
                            if (message.aiFlag != null && message.hasOwnProperty("aiFlag")) {
                                let error = $root.bilibili.community.service.dm.v1.DanmakuAIFlag.verify(message.aiFlag);
                                if (error)
                                    return "aiFlag." + error;
                            }
                            return null;
                        };

                        /**
                         * Creates a DmSegMobileReply message from a plain object. Also converts values to their respective internal types.
                         * @function fromObject
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @static
                         * @param {Object.<string,*>} object Plain object
                         * @returns {bilibili.community.service.dm.v1.DmSegMobileReply} DmSegMobileReply
                         */
                        DmSegMobileReply.fromObject = function fromObject(object) {
                            if (object instanceof $root.bilibili.community.service.dm.v1.DmSegMobileReply)
                                return object;
                            let message = new $root.bilibili.community.service.dm.v1.DmSegMobileReply();
                            if (object.elems) {
                                if (!Array.isArray(object.elems))
                                    throw TypeError(".bilibili.community.service.dm.v1.DmSegMobileReply.elems: array expected");
                                message.elems = [];
                                for (let i = 0; i < object.elems.length; ++i) {
                                    if (typeof object.elems[i] !== "object")
                                        throw TypeError(".bilibili.community.service.dm.v1.DmSegMobileReply.elems: object expected");
                                    message.elems[i] = $root.bilibili.community.service.dm.v1.DanmakuElem.fromObject(object.elems[i]);
                                }
                            }
                            if (object.state != null)
                                message.state = object.state | 0;
                            if (object.aiFlag != null) {
                                if (typeof object.aiFlag !== "object")
                                    throw TypeError(".bilibili.community.service.dm.v1.DmSegMobileReply.aiFlag: object expected");
                                message.aiFlag = $root.bilibili.community.service.dm.v1.DanmakuAIFlag.fromObject(object.aiFlag);
                            }
                            return message;
                        };

                        /**
                         * Creates a plain object from a DmSegMobileReply message. Also converts values to other types if specified.
                         * @function toObject
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @static
                         * @param {bilibili.community.service.dm.v1.DmSegMobileReply} message DmSegMobileReply
                         * @param {$protobuf.IConversionOptions} [options] Conversion options
                         * @returns {Object.<string,*>} Plain object
                         */
                        DmSegMobileReply.toObject = function toObject(message, options) {
                            if (!options)
                                options = {};
                            let object = {};
                            if (options.arrays || options.defaults)
                                object.elems = [];
                            if (options.defaults) {
                                object.state = 0;
                                object.aiFlag = null;
                            }
                            if (message.elems && message.elems.length) {
                                object.elems = [];
                                for (let j = 0; j < message.elems.length; ++j)
                                    object.elems[j] = $root.bilibili.community.service.dm.v1.DanmakuElem.toObject(message.elems[j], options);
                            }
                            if (message.state != null && message.hasOwnProperty("state"))
                                object.state = message.state;
                            if (message.aiFlag != null && message.hasOwnProperty("aiFlag"))
                                object.aiFlag = $root.bilibili.community.service.dm.v1.DanmakuAIFlag.toObject(message.aiFlag, options);
                            return object;
                        };

                        /**
                         * Converts this DmSegMobileReply to JSON.
                         * @function toJSON
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @instance
                         * @returns {Object.<string,*>} JSON object
                         */
                        DmSegMobileReply.prototype.toJSON = function toJSON() {
                            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                        };

                        /**
                         * Gets the default type url for DmSegMobileReply
                         * @function getTypeUrl
                         * @memberof bilibili.community.service.dm.v1.DmSegMobileReply
                         * @static
                         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                         * @returns {string} The default type url
                         */
                        DmSegMobileReply.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                            if (typeUrlPrefix === undefined) {
                                typeUrlPrefix = "type.googleapis.com";
                            }
                            return typeUrlPrefix + "/bilibili.community.service.dm.v1.DmSegMobileReply";
                        };

                        return DmSegMobileReply;
                    })();

                    v1.DanmakuElem = (function() {

                        /**
                         * Properties of a DanmakuElem.
                         * @memberof bilibili.community.service.dm.v1
                         * @interface IDanmakuElem
                         * @property {number|Long|null} [id] DanmakuElem id
                         * @property {number|null} [progress] DanmakuElem progress
                         * @property {number|null} [mode] DanmakuElem mode
                         * @property {number|null} [fontsize] DanmakuElem fontsize
                         * @property {number|null} [color] DanmakuElem color
                         * @property {string|null} [midHash] DanmakuElem midHash
                         * @property {string|null} [content] DanmakuElem content
                         * @property {number|Long|null} [ctime] DanmakuElem ctime
                         * @property {number|null} [weight] DanmakuElem weight
                         * @property {string|null} [action] DanmakuElem action
                         * @property {number|null} [pool] DanmakuElem pool
                         * @property {string|null} [idStr] DanmakuElem idStr
                         * @property {number|null} [attr] DanmakuElem attr
                         * @property {string|null} [animation] DanmakuElem animation
                         */

                        /**
                         * Constructs a new DanmakuElem.
                         * @memberof bilibili.community.service.dm.v1
                         * @classdesc Represents a DanmakuElem.
                         * @implements IDanmakuElem
                         * @constructor
                         * @param {bilibili.community.service.dm.v1.IDanmakuElem=} [properties] Properties to set
                         */
                        function DanmakuElem(properties) {
                            if (properties)
                                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                    if (properties[keys[i]] != null)
                                        this[keys[i]] = properties[keys[i]];
                        }

                        /**
                         * DanmakuElem id.
                         * @member {number|Long} id
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.id = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

                        /**
                         * DanmakuElem progress.
                         * @member {number} progress
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.progress = 0;

                        /**
                         * DanmakuElem mode.
                         * @member {number} mode
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.mode = 0;

                        /**
                         * DanmakuElem fontsize.
                         * @member {number} fontsize
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.fontsize = 0;

                        /**
                         * DanmakuElem color.
                         * @member {number} color
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.color = 0;

                        /**
                         * DanmakuElem midHash.
                         * @member {string} midHash
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.midHash = "";

                        /**
                         * DanmakuElem content.
                         * @member {string} content
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.content = "";

                        /**
                         * DanmakuElem ctime.
                         * @member {number|Long} ctime
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.ctime = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

                        /**
                         * DanmakuElem weight.
                         * @member {number} weight
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.weight = 0;

                        /**
                         * DanmakuElem action.
                         * @member {string} action
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.action = "";

                        /**
                         * DanmakuElem pool.
                         * @member {number} pool
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.pool = 0;

                        /**
                         * DanmakuElem idStr.
                         * @member {string} idStr
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.idStr = "";

                        /**
                         * DanmakuElem attr.
                         * @member {number} attr
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.attr = 0;

                        /**
                         * DanmakuElem animation.
                         * @member {string} animation
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         */
                        DanmakuElem.prototype.animation = "";

                        /**
                         * Creates a new DanmakuElem instance using the specified properties.
                         * @function create
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @static
                         * @param {bilibili.community.service.dm.v1.IDanmakuElem=} [properties] Properties to set
                         * @returns {bilibili.community.service.dm.v1.DanmakuElem} DanmakuElem instance
                         */
                        DanmakuElem.create = function create(properties) {
                            return new DanmakuElem(properties);
                        };

                        /**
                         * Encodes the specified DanmakuElem message. Does not implicitly {@link bilibili.community.service.dm.v1.DanmakuElem.verify|verify} messages.
                         * @function encode
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @static
                         * @param {bilibili.community.service.dm.v1.IDanmakuElem} message DanmakuElem message or plain object to encode
                         * @param {$protobuf.Writer} [writer] Writer to encode to
                         * @returns {$protobuf.Writer} Writer
                         */
                        DanmakuElem.encode = function encode(message, writer) {
                            if (!writer)
                                writer = $Writer.create();
                            if (message.id != null && Object.hasOwnProperty.call(message, "id"))
                                writer.uint32(/* id 1, wireType 0 =*/8).int64(message.id);
                            if (message.progress != null && Object.hasOwnProperty.call(message, "progress"))
                                writer.uint32(/* id 2, wireType 0 =*/16).int32(message.progress);
                            if (message.mode != null && Object.hasOwnProperty.call(message, "mode"))
                                writer.uint32(/* id 3, wireType 0 =*/24).int32(message.mode);
                            if (message.fontsize != null && Object.hasOwnProperty.call(message, "fontsize"))
                                writer.uint32(/* id 4, wireType 0 =*/32).int32(message.fontsize);
                            if (message.color != null && Object.hasOwnProperty.call(message, "color"))
                                writer.uint32(/* id 5, wireType 0 =*/40).uint32(message.color);
                            if (message.midHash != null && Object.hasOwnProperty.call(message, "midHash"))
                                writer.uint32(/* id 6, wireType 2 =*/50).string(message.midHash);
                            if (message.content != null && Object.hasOwnProperty.call(message, "content"))
                                writer.uint32(/* id 7, wireType 2 =*/58).string(message.content);
                            if (message.ctime != null && Object.hasOwnProperty.call(message, "ctime"))
                                writer.uint32(/* id 8, wireType 0 =*/64).int64(message.ctime);
                            if (message.weight != null && Object.hasOwnProperty.call(message, "weight"))
                                writer.uint32(/* id 9, wireType 0 =*/72).int32(message.weight);
                            if (message.action != null && Object.hasOwnProperty.call(message, "action"))
                                writer.uint32(/* id 10, wireType 2 =*/82).string(message.action);
                            if (message.pool != null && Object.hasOwnProperty.call(message, "pool"))
                                writer.uint32(/* id 11, wireType 0 =*/88).int32(message.pool);
                            if (message.idStr != null && Object.hasOwnProperty.call(message, "idStr"))
                                writer.uint32(/* id 12, wireType 2 =*/98).string(message.idStr);
                            if (message.attr != null && Object.hasOwnProperty.call(message, "attr"))
                                writer.uint32(/* id 13, wireType 0 =*/104).int32(message.attr);
                            if (message.animation != null && Object.hasOwnProperty.call(message, "animation"))
                                writer.uint32(/* id 22, wireType 2 =*/178).string(message.animation);
                            return writer;
                        };

                        /**
                         * Encodes the specified DanmakuElem message, length delimited. Does not implicitly {@link bilibili.community.service.dm.v1.DanmakuElem.verify|verify} messages.
                         * @function encodeDelimited
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @static
                         * @param {bilibili.community.service.dm.v1.IDanmakuElem} message DanmakuElem message or plain object to encode
                         * @param {$protobuf.Writer} [writer] Writer to encode to
                         * @returns {$protobuf.Writer} Writer
                         */
                        DanmakuElem.encodeDelimited = function encodeDelimited(message, writer) {
                            return this.encode(message, writer).ldelim();
                        };

                        /**
                         * Decodes a DanmakuElem message from the specified reader or buffer.
                         * @function decode
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @static
                         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                         * @param {number} [length] Message length if known beforehand
                         * @returns {bilibili.community.service.dm.v1.DanmakuElem} DanmakuElem
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        DanmakuElem.decode = function decode(reader, length, error) {
                            if (!(reader instanceof $Reader))
                                reader = $Reader.create(reader);
                            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.bilibili.community.service.dm.v1.DanmakuElem();
                            while (reader.pos < end) {
                                let tag = reader.uint32();
                                if (tag === error)
                                    break;
                                switch (tag >>> 3) {
                                case 1: {
                                        message.id = reader.int64();
                                        break;
                                    }
                                case 2: {
                                        message.progress = reader.int32();
                                        break;
                                    }
                                case 3: {
                                        message.mode = reader.int32();
                                        break;
                                    }
                                case 4: {
                                        message.fontsize = reader.int32();
                                        break;
                                    }
                                case 5: {
                                        message.color = reader.uint32();
                                        break;
                                    }
                                case 6: {
                                        message.midHash = reader.string();
                                        break;
                                    }
                                case 7: {
                                        message.content = reader.string();
                                        break;
                                    }
                                case 8: {
                                        message.ctime = reader.int64();
                                        break;
                                    }
                                case 9: {
                                        message.weight = reader.int32();
                                        break;
                                    }
                                case 10: {
                                        message.action = reader.string();
                                        break;
                                    }
                                case 11: {
                                        message.pool = reader.int32();
                                        break;
                                    }
                                case 12: {
                                        message.idStr = reader.string();
                                        break;
                                    }
                                case 13: {
                                        message.attr = reader.int32();
                                        break;
                                    }
                                case 22: {
                                        message.animation = reader.string();
                                        break;
                                    }
                                default:
                                    reader.skipType(tag & 7);
                                    break;
                                }
                            }
                            return message;
                        };

                        /**
                         * Decodes a DanmakuElem message from the specified reader or buffer, length delimited.
                         * @function decodeDelimited
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @static
                         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                         * @returns {bilibili.community.service.dm.v1.DanmakuElem} DanmakuElem
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        DanmakuElem.decodeDelimited = function decodeDelimited(reader) {
                            if (!(reader instanceof $Reader))
                                reader = new $Reader(reader);
                            return this.decode(reader, reader.uint32());
                        };

                        /**
                         * Verifies a DanmakuElem message.
                         * @function verify
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @static
                         * @param {Object.<string,*>} message Plain object to verify
                         * @returns {string|null} `null` if valid, otherwise the reason why it is not
                         */
                        DanmakuElem.verify = function verify(message) {
                            if (typeof message !== "object" || message === null)
                                return "object expected";
                            if (message.id != null && message.hasOwnProperty("id"))
                                if (!$util.isInteger(message.id) && !(message.id && $util.isInteger(message.id.low) && $util.isInteger(message.id.high)))
                                    return "id: integer|Long expected";
                            if (message.progress != null && message.hasOwnProperty("progress"))
                                if (!$util.isInteger(message.progress))
                                    return "progress: integer expected";
                            if (message.mode != null && message.hasOwnProperty("mode"))
                                if (!$util.isInteger(message.mode))
                                    return "mode: integer expected";
                            if (message.fontsize != null && message.hasOwnProperty("fontsize"))
                                if (!$util.isInteger(message.fontsize))
                                    return "fontsize: integer expected";
                            if (message.color != null && message.hasOwnProperty("color"))
                                if (!$util.isInteger(message.color))
                                    return "color: integer expected";
                            if (message.midHash != null && message.hasOwnProperty("midHash"))
                                if (!$util.isString(message.midHash))
                                    return "midHash: string expected";
                            if (message.content != null && message.hasOwnProperty("content"))
                                if (!$util.isString(message.content))
                                    return "content: string expected";
                            if (message.ctime != null && message.hasOwnProperty("ctime"))
                                if (!$util.isInteger(message.ctime) && !(message.ctime && $util.isInteger(message.ctime.low) && $util.isInteger(message.ctime.high)))
                                    return "ctime: integer|Long expected";
                            if (message.weight != null && message.hasOwnProperty("weight"))
                                if (!$util.isInteger(message.weight))
                                    return "weight: integer expected";
                            if (message.action != null && message.hasOwnProperty("action"))
                                if (!$util.isString(message.action))
                                    return "action: string expected";
                            if (message.pool != null && message.hasOwnProperty("pool"))
                                if (!$util.isInteger(message.pool))
                                    return "pool: integer expected";
                            if (message.idStr != null && message.hasOwnProperty("idStr"))
                                if (!$util.isString(message.idStr))
                                    return "idStr: string expected";
                            if (message.attr != null && message.hasOwnProperty("attr"))
                                if (!$util.isInteger(message.attr))
                                    return "attr: integer expected";
                            if (message.animation != null && message.hasOwnProperty("animation"))
                                if (!$util.isString(message.animation))
                                    return "animation: string expected";
                            return null;
                        };

                        /**
                         * Creates a DanmakuElem message from a plain object. Also converts values to their respective internal types.
                         * @function fromObject
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @static
                         * @param {Object.<string,*>} object Plain object
                         * @returns {bilibili.community.service.dm.v1.DanmakuElem} DanmakuElem
                         */
                        DanmakuElem.fromObject = function fromObject(object) {
                            if (object instanceof $root.bilibili.community.service.dm.v1.DanmakuElem)
                                return object;
                            let message = new $root.bilibili.community.service.dm.v1.DanmakuElem();
                            if (object.id != null)
                                if ($util.Long)
                                    (message.id = $util.Long.fromValue(object.id)).unsigned = false;
                                else if (typeof object.id === "string")
                                    message.id = parseInt(object.id, 10);
                                else if (typeof object.id === "number")
                                    message.id = object.id;
                                else if (typeof object.id === "object")
                                    message.id = new $util.LongBits(object.id.low >>> 0, object.id.high >>> 0).toNumber();
                            if (object.progress != null)
                                message.progress = object.progress | 0;
                            if (object.mode != null)
                                message.mode = object.mode | 0;
                            if (object.fontsize != null)
                                message.fontsize = object.fontsize | 0;
                            if (object.color != null)
                                message.color = object.color >>> 0;
                            if (object.midHash != null)
                                message.midHash = String(object.midHash);
                            if (object.content != null)
                                message.content = String(object.content);
                            if (object.ctime != null)
                                if ($util.Long)
                                    (message.ctime = $util.Long.fromValue(object.ctime)).unsigned = false;
                                else if (typeof object.ctime === "string")
                                    message.ctime = parseInt(object.ctime, 10);
                                else if (typeof object.ctime === "number")
                                    message.ctime = object.ctime;
                                else if (typeof object.ctime === "object")
                                    message.ctime = new $util.LongBits(object.ctime.low >>> 0, object.ctime.high >>> 0).toNumber();
                            if (object.weight != null)
                                message.weight = object.weight | 0;
                            if (object.action != null)
                                message.action = String(object.action);
                            if (object.pool != null)
                                message.pool = object.pool | 0;
                            if (object.idStr != null)
                                message.idStr = String(object.idStr);
                            if (object.attr != null)
                                message.attr = object.attr | 0;
                            if (object.animation != null)
                                message.animation = String(object.animation);
                            return message;
                        };

                        /**
                         * Creates a plain object from a DanmakuElem message. Also converts values to other types if specified.
                         * @function toObject
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @static
                         * @param {bilibili.community.service.dm.v1.DanmakuElem} message DanmakuElem
                         * @param {$protobuf.IConversionOptions} [options] Conversion options
                         * @returns {Object.<string,*>} Plain object
                         */
                        DanmakuElem.toObject = function toObject(message, options) {
                            if (!options)
                                options = {};
                            let object = {};
                            if (options.defaults) {
                                if ($util.Long) {
                                    let long = new $util.Long(0, 0, false);
                                    object.id = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                                } else
                                    object.id = options.longs === String ? "0" : 0;
                                object.progress = 0;
                                object.mode = 0;
                                object.fontsize = 0;
                                object.color = 0;
                                object.midHash = "";
                                object.content = "";
                                if ($util.Long) {
                                    let long = new $util.Long(0, 0, false);
                                    object.ctime = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                                } else
                                    object.ctime = options.longs === String ? "0" : 0;
                                object.weight = 0;
                                object.action = "";
                                object.pool = 0;
                                object.idStr = "";
                                object.attr = 0;
                                object.animation = "";
                            }
                            if (message.id != null && message.hasOwnProperty("id"))
                                if (typeof message.id === "number")
                                    object.id = options.longs === String ? String(message.id) : message.id;
                                else
                                    object.id = options.longs === String ? $util.Long.prototype.toString.call(message.id) : options.longs === Number ? new $util.LongBits(message.id.low >>> 0, message.id.high >>> 0).toNumber() : message.id;
                            if (message.progress != null && message.hasOwnProperty("progress"))
                                object.progress = message.progress;
                            if (message.mode != null && message.hasOwnProperty("mode"))
                                object.mode = message.mode;
                            if (message.fontsize != null && message.hasOwnProperty("fontsize"))
                                object.fontsize = message.fontsize;
                            if (message.color != null && message.hasOwnProperty("color"))
                                object.color = message.color;
                            if (message.midHash != null && message.hasOwnProperty("midHash"))
                                object.midHash = message.midHash;
                            if (message.content != null && message.hasOwnProperty("content"))
                                object.content = message.content;
                            if (message.ctime != null && message.hasOwnProperty("ctime"))
                                if (typeof message.ctime === "number")
                                    object.ctime = options.longs === String ? String(message.ctime) : message.ctime;
                                else
                                    object.ctime = options.longs === String ? $util.Long.prototype.toString.call(message.ctime) : options.longs === Number ? new $util.LongBits(message.ctime.low >>> 0, message.ctime.high >>> 0).toNumber() : message.ctime;
                            if (message.weight != null && message.hasOwnProperty("weight"))
                                object.weight = message.weight;
                            if (message.action != null && message.hasOwnProperty("action"))
                                object.action = message.action;
                            if (message.pool != null && message.hasOwnProperty("pool"))
                                object.pool = message.pool;
                            if (message.idStr != null && message.hasOwnProperty("idStr"))
                                object.idStr = message.idStr;
                            if (message.attr != null && message.hasOwnProperty("attr"))
                                object.attr = message.attr;
                            if (message.animation != null && message.hasOwnProperty("animation"))
                                object.animation = message.animation;
                            return object;
                        };

                        /**
                         * Converts this DanmakuElem to JSON.
                         * @function toJSON
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @instance
                         * @returns {Object.<string,*>} JSON object
                         */
                        DanmakuElem.prototype.toJSON = function toJSON() {
                            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                        };

                        /**
                         * Gets the default type url for DanmakuElem
                         * @function getTypeUrl
                         * @memberof bilibili.community.service.dm.v1.DanmakuElem
                         * @static
                         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                         * @returns {string} The default type url
                         */
                        DanmakuElem.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                            if (typeUrlPrefix === undefined) {
                                typeUrlPrefix = "type.googleapis.com";
                            }
                            return typeUrlPrefix + "/bilibili.community.service.dm.v1.DanmakuElem";
                        };

                        return DanmakuElem;
                    })();

                    v1.DanmakuAIFlag = (function() {

                        /**
                         * Properties of a DanmakuAIFlag.
                         * @memberof bilibili.community.service.dm.v1
                         * @interface IDanmakuAIFlag
                         * @property {Array.<bilibili.community.service.dm.v1.IDanmakuFlag>|null} [dmFlags] DanmakuAIFlag dmFlags
                         */

                        /**
                         * Constructs a new DanmakuAIFlag.
                         * @memberof bilibili.community.service.dm.v1
                         * @classdesc Represents a DanmakuAIFlag.
                         * @implements IDanmakuAIFlag
                         * @constructor
                         * @param {bilibili.community.service.dm.v1.IDanmakuAIFlag=} [properties] Properties to set
                         */
                        function DanmakuAIFlag(properties) {
                            this.dmFlags = [];
                            if (properties)
                                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                    if (properties[keys[i]] != null)
                                        this[keys[i]] = properties[keys[i]];
                        }

                        /**
                         * DanmakuAIFlag dmFlags.
                         * @member {Array.<bilibili.community.service.dm.v1.IDanmakuFlag>} dmFlags
                         * @memberof bilibili.community.service.dm.v1.DanmakuAIFlag
                         * @instance
                         */
                        DanmakuAIFlag.prototype.dmFlags = $util.emptyArray;

                        /**
                         * Creates a new DanmakuAIFlag instance using the specified properties.
                         * @function create
                         * @memberof bilibili.community.service.dm.v1.DanmakuAIFlag
                         * @static
                         * @param {bilibili.community.service.dm.v1.IDanmakuAIFlag=} [properties] Properties to set
                         * @returns {bilibili.community.service.dm.v1.DanmakuAIFlag} DanmakuAIFlag instance
                         */
                        DanmakuAIFlag.create = function create(properties) {
                            return new DanmakuAIFlag(properties);
                        };

                        /**
                         * Encodes the specified DanmakuAIFlag message. Does not implicitly {@link bilibili.community.service.dm.v1.DanmakuAIFlag.verify|verify} messages.
                         * @function encode
                         * @memberof bilibili.community.service.dm.v1.DanmakuAIFlag
                         * @static
                         * @param {bilibili.community.service.dm.v1.IDanmakuAIFlag} message DanmakuAIFlag message or plain object to encode
                         * @param {$protobuf.Writer} [writer] Writer to encode to
                         * @returns {$protobuf.Writer} Writer
                         */
                        DanmakuAIFlag.encode = function encode(message, writer) {
                            if (!writer)
                                writer = $Writer.create();
                            if (message.dmFlags != null && message.dmFlags.length)
                                for (let i = 0; i < message.dmFlags.length; ++i)
                                    $root.bilibili.community.service.dm.v1.DanmakuFlag.encode(message.dmFlags[i], writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
                            return writer;
                        };

                        /**
                         * Encodes the specified DanmakuAIFlag message, length delimited. Does not implicitly {@link bilibili.community.service.dm.v1.DanmakuAIFlag.verify|verify} messages.
                         * @function encodeDelimited
                         * @memberof bilibili.community.service.dm.v1.DanmakuAIFlag
                         * @static
                         * @param {bilibili.community.service.dm.v1.IDanmakuAIFlag} message DanmakuAIFlag message or plain object to encode
                         * @param {$protobuf.Writer} [writer] Writer to encode to
                         * @returns {$protobuf.Writer} Writer
                         */
                        DanmakuAIFlag.encodeDelimited = function encodeDelimited(message, writer) {
                            return this.encode(message, writer).ldelim();
                        };

                        /**
                         * Decodes a DanmakuAIFlag message from the specified reader or buffer.
                         * @function decode
                         * @memberof bilibili.community.service.dm.v1.DanmakuAIFlag
                         * @static
                         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                         * @param {number} [length] Message length if known beforehand
                         * @returns {bilibili.community.service.dm.v1.DanmakuAIFlag} DanmakuAIFlag
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        DanmakuAIFlag.decode = function decode(reader, length, error) {
                            if (!(reader instanceof $Reader))
                                reader = $Reader.create(reader);
                            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.bilibili.community.service.dm.v1.DanmakuAIFlag();
                            while (reader.pos < end) {
                                let tag = reader.uint32();
                                if (tag === error)
                                    break;
                                switch (tag >>> 3) {
                                case 1: {
                                        if (!(message.dmFlags && message.dmFlags.length))
                                            message.dmFlags = [];
                                        message.dmFlags.push($root.bilibili.community.service.dm.v1.DanmakuFlag.decode(reader, reader.uint32()));
                                        break;
                                    }
                                default:
                                    reader.skipType(tag & 7);
                                    break;
                                }
                            }
                            return message;
                        };

                        /**
                         * Decodes a DanmakuAIFlag message from the specified reader or buffer, length delimited.
                         * @function decodeDelimited
                         * @memberof bilibili.community.service.dm.v1.DanmakuAIFlag
                         * @static
                         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                         * @returns {bilibili.community.service.dm.v1.DanmakuAIFlag} DanmakuAIFlag
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        DanmakuAIFlag.decodeDelimited = function decodeDelimited(reader) {
                            if (!(reader instanceof $Reader))
                                reader = new $Reader(reader);
                            return this.decode(reader, reader.uint32());
                        };

                        /**
                         * Verifies a DanmakuAIFlag message.
                         * @function verify
                         * @memberof bilibili.community.service.dm.v1.DanmakuAIFlag
                         * @static
                         * @param {Object.<string,*>} message Plain object to verify
                         * @returns {string|null} `null` if valid, otherwise the reason why it is not
                         */
                        DanmakuAIFlag.verify = function verify(message) {
                            if (typeof message !== "object" || message === null)
                                return "object expected";
                            if (message.dmFlags != null && message.hasOwnProperty("dmFlags")) {
                                if (!Array.isArray(message.dmFlags))
                                    return "dmFlags: array expected";
                                for (let i = 0; i < message.dmFlags.length; ++i) {
                                    let error = $root.bilibili.community.service.dm.v1.DanmakuFlag.verify(message.dmFlags[i]);
                                    if (error)
                                        return "dmFlags." + error;
                                }
                            }
                            return null;
                        };

                        /**
                         * Creates a DanmakuAIFlag message from a plain object. Also converts values to their respective internal types.
                         * @function fromObject
                         * @memberof bilibili.community.service.dm.v1.DanmakuAIFlag
                         * @static
                         * @param {Object.<string,*>} object Plain object
                         * @returns {bilibili.community.service.dm.v1.DanmakuAIFlag} DanmakuAIFlag
                         */
                        DanmakuAIFlag.fromObject = function fromObject(object) {
                            if (object instanceof $root.bilibili.community.service.dm.v1.DanmakuAIFlag)
                                return object;
                            let message = new $root.bilibili.community.service.dm.v1.DanmakuAIFlag();
                            if (object.dmFlags) {
                                if (!Array.isArray(object.dmFlags))
                                    throw TypeError(".bilibili.community.service.dm.v1.DanmakuAIFlag.dmFlags: array expected");
                                message.dmFlags = [];
                                for (let i = 0; i < object.dmFlags.length; ++i) {
                                    if (typeof object.dmFlags[i] !== "object")
                                        throw TypeError(".bilibili.community.service.dm.v1.DanmakuAIFlag.dmFlags: object expected");
                                    message.dmFlags[i] = $root.bilibili.community.service.dm.v1.DanmakuFlag.fromObject(object.dmFlags[i]);
                                }
                            }
                            return message;
                        };

                        /**
                         * Creates a plain object from a DanmakuAIFlag message. Also converts values to other types if specified.
                         * @function toObject
                         * @memberof bilibili.community.service.dm.v1.DanmakuAIFlag
                         * @static
                         * @param {bilibili.community.service.dm.v1.DanmakuAIFlag} message DanmakuAIFlag
                         * @param {$protobuf.IConversionOptions} [options] Conversion options
                         * @returns {Object.<string,*>} Plain object
                         */
                        DanmakuAIFlag.toObject = function toObject(message, options) {
                            if (!options)
                                options = {};
                            let object = {};
                            if (options.arrays || options.defaults)
                                object.dmFlags = [];
                            if (message.dmFlags && message.dmFlags.length) {
                                object.dmFlags = [];
                                for (let j = 0; j < message.dmFlags.length; ++j)
                                    object.dmFlags[j] = $root.bilibili.community.service.dm.v1.DanmakuFlag.toObject(message.dmFlags[j], options);
                            }
                            return object;
                        };

                        /**
                         * Converts this DanmakuAIFlag to JSON.
                         * @function toJSON
                         * @memberof bilibili.community.service.dm.v1.DanmakuAIFlag
                         * @instance
                         * @returns {Object.<string,*>} JSON object
                         */
                        DanmakuAIFlag.prototype.toJSON = function toJSON() {
                            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                        };

                        /**
                         * Gets the default type url for DanmakuAIFlag
                         * @function getTypeUrl
                         * @memberof bilibili.community.service.dm.v1.DanmakuAIFlag
                         * @static
                         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                         * @returns {string} The default type url
                         */
                        DanmakuAIFlag.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                            if (typeUrlPrefix === undefined) {
                                typeUrlPrefix = "type.googleapis.com";
                            }
                            return typeUrlPrefix + "/bilibili.community.service.dm.v1.DanmakuAIFlag";
                        };

                        return DanmakuAIFlag;
                    })();

                    v1.DanmakuFlag = (function() {

                        /**
                         * Properties of a DanmakuFlag.
                         * @memberof bilibili.community.service.dm.v1
                         * @interface IDanmakuFlag
                         * @property {number|Long|null} [dmid] DanmakuFlag dmid
                         * @property {number|null} [flag] DanmakuFlag flag
                         */

                        /**
                         * Constructs a new DanmakuFlag.
                         * @memberof bilibili.community.service.dm.v1
                         * @classdesc Represents a DanmakuFlag.
                         * @implements IDanmakuFlag
                         * @constructor
                         * @param {bilibili.community.service.dm.v1.IDanmakuFlag=} [properties] Properties to set
                         */
                        function DanmakuFlag(properties) {
                            if (properties)
                                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                                    if (properties[keys[i]] != null)
                                        this[keys[i]] = properties[keys[i]];
                        }

                        /**
                         * DanmakuFlag dmid.
                         * @member {number|Long} dmid
                         * @memberof bilibili.community.service.dm.v1.DanmakuFlag
                         * @instance
                         */
                        DanmakuFlag.prototype.dmid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

                        /**
                         * DanmakuFlag flag.
                         * @member {number} flag
                         * @memberof bilibili.community.service.dm.v1.DanmakuFlag
                         * @instance
                         */
                        DanmakuFlag.prototype.flag = 0;

                        /**
                         * Creates a new DanmakuFlag instance using the specified properties.
                         * @function create
                         * @memberof bilibili.community.service.dm.v1.DanmakuFlag
                         * @static
                         * @param {bilibili.community.service.dm.v1.IDanmakuFlag=} [properties] Properties to set
                         * @returns {bilibili.community.service.dm.v1.DanmakuFlag} DanmakuFlag instance
                         */
                        DanmakuFlag.create = function create(properties) {
                            return new DanmakuFlag(properties);
                        };

                        /**
                         * Encodes the specified DanmakuFlag message. Does not implicitly {@link bilibili.community.service.dm.v1.DanmakuFlag.verify|verify} messages.
                         * @function encode
                         * @memberof bilibili.community.service.dm.v1.DanmakuFlag
                         * @static
                         * @param {bilibili.community.service.dm.v1.IDanmakuFlag} message DanmakuFlag message or plain object to encode
                         * @param {$protobuf.Writer} [writer] Writer to encode to
                         * @returns {$protobuf.Writer} Writer
                         */
                        DanmakuFlag.encode = function encode(message, writer) {
                            if (!writer)
                                writer = $Writer.create();
                            if (message.dmid != null && Object.hasOwnProperty.call(message, "dmid"))
                                writer.uint32(/* id 1, wireType 0 =*/8).int64(message.dmid);
                            if (message.flag != null && Object.hasOwnProperty.call(message, "flag"))
                                writer.uint32(/* id 2, wireType 0 =*/16).uint32(message.flag);
                            return writer;
                        };

                        /**
                         * Encodes the specified DanmakuFlag message, length delimited. Does not implicitly {@link bilibili.community.service.dm.v1.DanmakuFlag.verify|verify} messages.
                         * @function encodeDelimited
                         * @memberof bilibili.community.service.dm.v1.DanmakuFlag
                         * @static
                         * @param {bilibili.community.service.dm.v1.IDanmakuFlag} message DanmakuFlag message or plain object to encode
                         * @param {$protobuf.Writer} [writer] Writer to encode to
                         * @returns {$protobuf.Writer} Writer
                         */
                        DanmakuFlag.encodeDelimited = function encodeDelimited(message, writer) {
                            return this.encode(message, writer).ldelim();
                        };

                        /**
                         * Decodes a DanmakuFlag message from the specified reader or buffer.
                         * @function decode
                         * @memberof bilibili.community.service.dm.v1.DanmakuFlag
                         * @static
                         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                         * @param {number} [length] Message length if known beforehand
                         * @returns {bilibili.community.service.dm.v1.DanmakuFlag} DanmakuFlag
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        DanmakuFlag.decode = function decode(reader, length, error) {
                            if (!(reader instanceof $Reader))
                                reader = $Reader.create(reader);
                            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.bilibili.community.service.dm.v1.DanmakuFlag();
                            while (reader.pos < end) {
                                let tag = reader.uint32();
                                if (tag === error)
                                    break;
                                switch (tag >>> 3) {
                                case 1: {
                                        message.dmid = reader.int64();
                                        break;
                                    }
                                case 2: {
                                        message.flag = reader.uint32();
                                        break;
                                    }
                                default:
                                    reader.skipType(tag & 7);
                                    break;
                                }
                            }
                            return message;
                        };

                        /**
                         * Decodes a DanmakuFlag message from the specified reader or buffer, length delimited.
                         * @function decodeDelimited
                         * @memberof bilibili.community.service.dm.v1.DanmakuFlag
                         * @static
                         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
                         * @returns {bilibili.community.service.dm.v1.DanmakuFlag} DanmakuFlag
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        DanmakuFlag.decodeDelimited = function decodeDelimited(reader) {
                            if (!(reader instanceof $Reader))
                                reader = new $Reader(reader);
                            return this.decode(reader, reader.uint32());
                        };

                        /**
                         * Verifies a DanmakuFlag message.
                         * @function verify
                         * @memberof bilibili.community.service.dm.v1.DanmakuFlag
                         * @static
                         * @param {Object.<string,*>} message Plain object to verify
                         * @returns {string|null} `null` if valid, otherwise the reason why it is not
                         */
                        DanmakuFlag.verify = function verify(message) {
                            if (typeof message !== "object" || message === null)
                                return "object expected";
                            if (message.dmid != null && message.hasOwnProperty("dmid"))
                                if (!$util.isInteger(message.dmid) && !(message.dmid && $util.isInteger(message.dmid.low) && $util.isInteger(message.dmid.high)))
                                    return "dmid: integer|Long expected";
                            if (message.flag != null && message.hasOwnProperty("flag"))
                                if (!$util.isInteger(message.flag))
                                    return "flag: integer expected";
                            return null;
                        };

                        /**
                         * Creates a DanmakuFlag message from a plain object. Also converts values to their respective internal types.
                         * @function fromObject
                         * @memberof bilibili.community.service.dm.v1.DanmakuFlag
                         * @static
                         * @param {Object.<string,*>} object Plain object
                         * @returns {bilibili.community.service.dm.v1.DanmakuFlag} DanmakuFlag
                         */
                        DanmakuFlag.fromObject = function fromObject(object) {
                            if (object instanceof $root.bilibili.community.service.dm.v1.DanmakuFlag)
                                return object;
                            let message = new $root.bilibili.community.service.dm.v1.DanmakuFlag();
                            if (object.dmid != null)
                                if ($util.Long)
                                    (message.dmid = $util.Long.fromValue(object.dmid)).unsigned = false;
                                else if (typeof object.dmid === "string")
                                    message.dmid = parseInt(object.dmid, 10);
                                else if (typeof object.dmid === "number")
                                    message.dmid = object.dmid;
                                else if (typeof object.dmid === "object")
                                    message.dmid = new $util.LongBits(object.dmid.low >>> 0, object.dmid.high >>> 0).toNumber();
                            if (object.flag != null)
                                message.flag = object.flag >>> 0;
                            return message;
                        };

                        /**
                         * Creates a plain object from a DanmakuFlag message. Also converts values to other types if specified.
                         * @function toObject
                         * @memberof bilibili.community.service.dm.v1.DanmakuFlag
                         * @static
                         * @param {bilibili.community.service.dm.v1.DanmakuFlag} message DanmakuFlag
                         * @param {$protobuf.IConversionOptions} [options] Conversion options
                         * @returns {Object.<string,*>} Plain object
                         */
                        DanmakuFlag.toObject = function toObject(message, options) {
                            if (!options)
                                options = {};
                            let object = {};
                            if (options.defaults) {
                                if ($util.Long) {
                                    let long = new $util.Long(0, 0, false);
                                    object.dmid = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                                } else
                                    object.dmid = options.longs === String ? "0" : 0;
                                object.flag = 0;
                            }
                            if (message.dmid != null && message.hasOwnProperty("dmid"))
                                if (typeof message.dmid === "number")
                                    object.dmid = options.longs === String ? String(message.dmid) : message.dmid;
                                else
                                    object.dmid = options.longs === String ? $util.Long.prototype.toString.call(message.dmid) : options.longs === Number ? new $util.LongBits(message.dmid.low >>> 0, message.dmid.high >>> 0).toNumber() : message.dmid;
                            if (message.flag != null && message.hasOwnProperty("flag"))
                                object.flag = message.flag;
                            return object;
                        };

                        /**
                         * Converts this DanmakuFlag to JSON.
                         * @function toJSON
                         * @memberof bilibili.community.service.dm.v1.DanmakuFlag
                         * @instance
                         * @returns {Object.<string,*>} JSON object
                         */
                        DanmakuFlag.prototype.toJSON = function toJSON() {
                            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
                        };

                        /**
                         * Gets the default type url for DanmakuFlag
                         * @function getTypeUrl
                         * @memberof bilibili.community.service.dm.v1.DanmakuFlag
                         * @static
                         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                         * @returns {string} The default type url
                         */
                        DanmakuFlag.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                            if (typeUrlPrefix === undefined) {
                                typeUrlPrefix = "type.googleapis.com";
                            }
                            return typeUrlPrefix + "/bilibili.community.service.dm.v1.DanmakuFlag";
                        };

                        return DanmakuFlag;
                    })();

                    return v1;
                })();

                return dm;
            })();

            return service;
        })();

        return community;
    })();

    return bilibili;
})();

export { $root as default };
