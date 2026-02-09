import $protobuf from "@ohos/protobufjs";
import Long = require("long");
$protobuf.util.Long=Long
$protobuf.configure()
/** Namespace bilibili. */
export namespace bilibili {

    /** Namespace community. */
    namespace community {

        /** Namespace service. */
        namespace service {

            /** Namespace dm. */
            namespace dm {

                /** Namespace v1. */
                namespace v1 {

                    /** Properties of a DmSegMobileReply. */
                    interface IDmSegMobileReply {

                        /** DmSegMobileReply elems */
                        elems?: (bilibili.community.service.dm.v1.IDanmakuElem[]|null);

                        /** DmSegMobileReply state */
                        state?: (number|null);

                        /** DmSegMobileReply aiFlag */
                        aiFlag?: (bilibili.community.service.dm.v1.IDanmakuAIFlag|null);
                    }

                    /** Represents a DmSegMobileReply. */
                    class DmSegMobileReply implements IDmSegMobileReply {

                        /**
                         * Constructs a new DmSegMobileReply.
                         * @param [properties] Properties to set
                         */
                        constructor(properties?: bilibili.community.service.dm.v1.IDmSegMobileReply);

                        /** DmSegMobileReply elems. */
                        public elems: bilibili.community.service.dm.v1.IDanmakuElem[];

                        /** DmSegMobileReply state. */
                        public state: number;

                        /** DmSegMobileReply aiFlag. */
                        public aiFlag?: (bilibili.community.service.dm.v1.IDanmakuAIFlag|null);

                        /**
                         * Creates a new DmSegMobileReply instance using the specified properties.
                         * @param [properties] Properties to set
                         * @returns DmSegMobileReply instance
                         */
                        public static create(properties?: bilibili.community.service.dm.v1.IDmSegMobileReply): bilibili.community.service.dm.v1.DmSegMobileReply;

                        /**
                         * Encodes the specified DmSegMobileReply message. Does not implicitly {@link bilibili.community.service.dm.v1.DmSegMobileReply.verify|verify} messages.
                         * @param message DmSegMobileReply message or plain object to encode
                         * @param [writer] Writer to encode to
                         * @returns Writer
                         */
                        public static encode(message: bilibili.community.service.dm.v1.IDmSegMobileReply, writer?: $protobuf.Writer): $protobuf.Writer;

                        /**
                         * Encodes the specified DmSegMobileReply message, length delimited. Does not implicitly {@link bilibili.community.service.dm.v1.DmSegMobileReply.verify|verify} messages.
                         * @param message DmSegMobileReply message or plain object to encode
                         * @param [writer] Writer to encode to
                         * @returns Writer
                         */
                        public static encodeDelimited(message: bilibili.community.service.dm.v1.IDmSegMobileReply, writer?: $protobuf.Writer): $protobuf.Writer;

                        /**
                         * Decodes a DmSegMobileReply message from the specified reader or buffer.
                         * @param reader Reader or buffer to decode from
                         * @param [length] Message length if known beforehand
                         * @returns DmSegMobileReply
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): bilibili.community.service.dm.v1.DmSegMobileReply;

                        /**
                         * Decodes a DmSegMobileReply message from the specified reader or buffer, length delimited.
                         * @param reader Reader or buffer to decode from
                         * @returns DmSegMobileReply
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): bilibili.community.service.dm.v1.DmSegMobileReply;

                        /**
                         * Verifies a DmSegMobileReply message.
                         * @param message Plain object to verify
                         * @returns `null` if valid, otherwise the reason why it is not
                         */
                        public static verify(message: { [k: string]: any }): (string|null);

                        /**
                         * Creates a DmSegMobileReply message from a plain object. Also converts values to their respective internal types.
                         * @param object Plain object
                         * @returns DmSegMobileReply
                         */
                        public static fromObject(object: { [k: string]: any }): bilibili.community.service.dm.v1.DmSegMobileReply;

                        /**
                         * Creates a plain object from a DmSegMobileReply message. Also converts values to other types if specified.
                         * @param message DmSegMobileReply
                         * @param [options] Conversion options
                         * @returns Plain object
                         */
                        public static toObject(message: bilibili.community.service.dm.v1.DmSegMobileReply, options?: $protobuf.IConversionOptions): { [k: string]: any };

                        /**
                         * Converts this DmSegMobileReply to JSON.
                         * @returns JSON object
                         */
                        public toJSON(): { [k: string]: any };

                        /**
                         * Gets the default type url for DmSegMobileReply
                         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                         * @returns The default type url
                         */
                        public static getTypeUrl(typeUrlPrefix?: string): string;
                    }

                    /** Properties of a DanmakuElem. */
                    interface IDanmakuElem {

                        /** DanmakuElem id */
                        id?: (number|Long|null);

                        /** DanmakuElem progress */
                        progress?: (number|null);

                        /** DanmakuElem mode */
                        mode?: (number|null);

                        /** DanmakuElem fontsize */
                        fontsize?: (number|null);

                        /** DanmakuElem color */
                        color?: (number|null);

                        /** DanmakuElem midHash */
                        midHash?: (string|null);

                        /** DanmakuElem content */
                        content?: (string|null);

                        /** DanmakuElem ctime */
                        ctime?: (number|Long|null);

                        /** DanmakuElem weight */
                        weight?: (number|null);

                        /** DanmakuElem action */
                        action?: (string|null);

                        /** DanmakuElem pool */
                        pool?: (number|null);

                        /** DanmakuElem idStr */
                        idStr?: (string|null);

                        /** DanmakuElem attr */
                        attr?: (number|null);

                        /** DanmakuElem animation */
                        animation?: (string|null);
                    }

                    /** Represents a DanmakuElem. */
                    class DanmakuElem implements IDanmakuElem {

                        /**
                         * Constructs a new DanmakuElem.
                         * @param [properties] Properties to set
                         */
                        constructor(properties?: bilibili.community.service.dm.v1.IDanmakuElem);

                        /** DanmakuElem id. */
                        public id: (number|Long);

                        /** DanmakuElem progress. */
                        public progress: number;

                        /** DanmakuElem mode. */
                        public mode: number;

                        /** DanmakuElem fontsize. */
                        public fontsize: number;

                        /** DanmakuElem color. */
                        public color: number;

                        /** DanmakuElem midHash. */
                        public midHash: string;

                        /** DanmakuElem content. */
                        public content: string;

                        /** DanmakuElem ctime. */
                        public ctime: (number|Long);

                        /** DanmakuElem weight. */
                        public weight: number;

                        /** DanmakuElem action. */
                        public action: string;

                        /** DanmakuElem pool. */
                        public pool: number;

                        /** DanmakuElem idStr. */
                        public idStr: string;

                        /** DanmakuElem attr. */
                        public attr: number;

                        /** DanmakuElem animation. */
                        public animation: string;

                        /**
                         * Creates a new DanmakuElem instance using the specified properties.
                         * @param [properties] Properties to set
                         * @returns DanmakuElem instance
                         */
                        public static create(properties?: bilibili.community.service.dm.v1.IDanmakuElem): bilibili.community.service.dm.v1.DanmakuElem;

                        /**
                         * Encodes the specified DanmakuElem message. Does not implicitly {@link bilibili.community.service.dm.v1.DanmakuElem.verify|verify} messages.
                         * @param message DanmakuElem message or plain object to encode
                         * @param [writer] Writer to encode to
                         * @returns Writer
                         */
                        public static encode(message: bilibili.community.service.dm.v1.IDanmakuElem, writer?: $protobuf.Writer): $protobuf.Writer;

                        /**
                         * Encodes the specified DanmakuElem message, length delimited. Does not implicitly {@link bilibili.community.service.dm.v1.DanmakuElem.verify|verify} messages.
                         * @param message DanmakuElem message or plain object to encode
                         * @param [writer] Writer to encode to
                         * @returns Writer
                         */
                        public static encodeDelimited(message: bilibili.community.service.dm.v1.IDanmakuElem, writer?: $protobuf.Writer): $protobuf.Writer;

                        /**
                         * Decodes a DanmakuElem message from the specified reader or buffer.
                         * @param reader Reader or buffer to decode from
                         * @param [length] Message length if known beforehand
                         * @returns DanmakuElem
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): bilibili.community.service.dm.v1.DanmakuElem;

                        /**
                         * Decodes a DanmakuElem message from the specified reader or buffer, length delimited.
                         * @param reader Reader or buffer to decode from
                         * @returns DanmakuElem
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): bilibili.community.service.dm.v1.DanmakuElem;

                        /**
                         * Verifies a DanmakuElem message.
                         * @param message Plain object to verify
                         * @returns `null` if valid, otherwise the reason why it is not
                         */
                        public static verify(message: { [k: string]: any }): (string|null);

                        /**
                         * Creates a DanmakuElem message from a plain object. Also converts values to their respective internal types.
                         * @param object Plain object
                         * @returns DanmakuElem
                         */
                        public static fromObject(object: { [k: string]: any }): bilibili.community.service.dm.v1.DanmakuElem;

                        /**
                         * Creates a plain object from a DanmakuElem message. Also converts values to other types if specified.
                         * @param message DanmakuElem
                         * @param [options] Conversion options
                         * @returns Plain object
                         */
                        public static toObject(message: bilibili.community.service.dm.v1.DanmakuElem, options?: $protobuf.IConversionOptions): { [k: string]: any };

                        /**
                         * Converts this DanmakuElem to JSON.
                         * @returns JSON object
                         */
                        public toJSON(): { [k: string]: any };

                        /**
                         * Gets the default type url for DanmakuElem
                         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                         * @returns The default type url
                         */
                        public static getTypeUrl(typeUrlPrefix?: string): string;
                    }

                    /** Properties of a DanmakuAIFlag. */
                    interface IDanmakuAIFlag {

                        /** DanmakuAIFlag dmFlags */
                        dmFlags?: (bilibili.community.service.dm.v1.IDanmakuFlag[]|null);
                    }

                    /** Represents a DanmakuAIFlag. */
                    class DanmakuAIFlag implements IDanmakuAIFlag {

                        /**
                         * Constructs a new DanmakuAIFlag.
                         * @param [properties] Properties to set
                         */
                        constructor(properties?: bilibili.community.service.dm.v1.IDanmakuAIFlag);

                        /** DanmakuAIFlag dmFlags. */
                        public dmFlags: bilibili.community.service.dm.v1.IDanmakuFlag[];

                        /**
                         * Creates a new DanmakuAIFlag instance using the specified properties.
                         * @param [properties] Properties to set
                         * @returns DanmakuAIFlag instance
                         */
                        public static create(properties?: bilibili.community.service.dm.v1.IDanmakuAIFlag): bilibili.community.service.dm.v1.DanmakuAIFlag;

                        /**
                         * Encodes the specified DanmakuAIFlag message. Does not implicitly {@link bilibili.community.service.dm.v1.DanmakuAIFlag.verify|verify} messages.
                         * @param message DanmakuAIFlag message or plain object to encode
                         * @param [writer] Writer to encode to
                         * @returns Writer
                         */
                        public static encode(message: bilibili.community.service.dm.v1.IDanmakuAIFlag, writer?: $protobuf.Writer): $protobuf.Writer;

                        /**
                         * Encodes the specified DanmakuAIFlag message, length delimited. Does not implicitly {@link bilibili.community.service.dm.v1.DanmakuAIFlag.verify|verify} messages.
                         * @param message DanmakuAIFlag message or plain object to encode
                         * @param [writer] Writer to encode to
                         * @returns Writer
                         */
                        public static encodeDelimited(message: bilibili.community.service.dm.v1.IDanmakuAIFlag, writer?: $protobuf.Writer): $protobuf.Writer;

                        /**
                         * Decodes a DanmakuAIFlag message from the specified reader or buffer.
                         * @param reader Reader or buffer to decode from
                         * @param [length] Message length if known beforehand
                         * @returns DanmakuAIFlag
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): bilibili.community.service.dm.v1.DanmakuAIFlag;

                        /**
                         * Decodes a DanmakuAIFlag message from the specified reader or buffer, length delimited.
                         * @param reader Reader or buffer to decode from
                         * @returns DanmakuAIFlag
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): bilibili.community.service.dm.v1.DanmakuAIFlag;

                        /**
                         * Verifies a DanmakuAIFlag message.
                         * @param message Plain object to verify
                         * @returns `null` if valid, otherwise the reason why it is not
                         */
                        public static verify(message: { [k: string]: any }): (string|null);

                        /**
                         * Creates a DanmakuAIFlag message from a plain object. Also converts values to their respective internal types.
                         * @param object Plain object
                         * @returns DanmakuAIFlag
                         */
                        public static fromObject(object: { [k: string]: any }): bilibili.community.service.dm.v1.DanmakuAIFlag;

                        /**
                         * Creates a plain object from a DanmakuAIFlag message. Also converts values to other types if specified.
                         * @param message DanmakuAIFlag
                         * @param [options] Conversion options
                         * @returns Plain object
                         */
                        public static toObject(message: bilibili.community.service.dm.v1.DanmakuAIFlag, options?: $protobuf.IConversionOptions): { [k: string]: any };

                        /**
                         * Converts this DanmakuAIFlag to JSON.
                         * @returns JSON object
                         */
                        public toJSON(): { [k: string]: any };

                        /**
                         * Gets the default type url for DanmakuAIFlag
                         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                         * @returns The default type url
                         */
                        public static getTypeUrl(typeUrlPrefix?: string): string;
                    }

                    /** Properties of a DanmakuFlag. */
                    interface IDanmakuFlag {

                        /** DanmakuFlag dmid */
                        dmid?: (number|Long|null);

                        /** DanmakuFlag flag */
                        flag?: (number|null);
                    }

                    /** Represents a DanmakuFlag. */
                    class DanmakuFlag implements IDanmakuFlag {

                        /**
                         * Constructs a new DanmakuFlag.
                         * @param [properties] Properties to set
                         */
                        constructor(properties?: bilibili.community.service.dm.v1.IDanmakuFlag);

                        /** DanmakuFlag dmid. */
                        public dmid: (number|Long);

                        /** DanmakuFlag flag. */
                        public flag: number;

                        /**
                         * Creates a new DanmakuFlag instance using the specified properties.
                         * @param [properties] Properties to set
                         * @returns DanmakuFlag instance
                         */
                        public static create(properties?: bilibili.community.service.dm.v1.IDanmakuFlag): bilibili.community.service.dm.v1.DanmakuFlag;

                        /**
                         * Encodes the specified DanmakuFlag message. Does not implicitly {@link bilibili.community.service.dm.v1.DanmakuFlag.verify|verify} messages.
                         * @param message DanmakuFlag message or plain object to encode
                         * @param [writer] Writer to encode to
                         * @returns Writer
                         */
                        public static encode(message: bilibili.community.service.dm.v1.IDanmakuFlag, writer?: $protobuf.Writer): $protobuf.Writer;

                        /**
                         * Encodes the specified DanmakuFlag message, length delimited. Does not implicitly {@link bilibili.community.service.dm.v1.DanmakuFlag.verify|verify} messages.
                         * @param message DanmakuFlag message or plain object to encode
                         * @param [writer] Writer to encode to
                         * @returns Writer
                         */
                        public static encodeDelimited(message: bilibili.community.service.dm.v1.IDanmakuFlag, writer?: $protobuf.Writer): $protobuf.Writer;

                        /**
                         * Decodes a DanmakuFlag message from the specified reader or buffer.
                         * @param reader Reader or buffer to decode from
                         * @param [length] Message length if known beforehand
                         * @returns DanmakuFlag
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): bilibili.community.service.dm.v1.DanmakuFlag;

                        /**
                         * Decodes a DanmakuFlag message from the specified reader or buffer, length delimited.
                         * @param reader Reader or buffer to decode from
                         * @returns DanmakuFlag
                         * @throws {Error} If the payload is not a reader or valid buffer
                         * @throws {$protobuf.util.ProtocolError} If required fields are missing
                         */
                        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): bilibili.community.service.dm.v1.DanmakuFlag;

                        /**
                         * Verifies a DanmakuFlag message.
                         * @param message Plain object to verify
                         * @returns `null` if valid, otherwise the reason why it is not
                         */
                        public static verify(message: { [k: string]: any }): (string|null);

                        /**
                         * Creates a DanmakuFlag message from a plain object. Also converts values to their respective internal types.
                         * @param object Plain object
                         * @returns DanmakuFlag
                         */
                        public static fromObject(object: { [k: string]: any }): bilibili.community.service.dm.v1.DanmakuFlag;

                        /**
                         * Creates a plain object from a DanmakuFlag message. Also converts values to other types if specified.
                         * @param message DanmakuFlag
                         * @param [options] Conversion options
                         * @returns Plain object
                         */
                        public static toObject(message: bilibili.community.service.dm.v1.DanmakuFlag, options?: $protobuf.IConversionOptions): { [k: string]: any };

                        /**
                         * Converts this DanmakuFlag to JSON.
                         * @returns JSON object
                         */
                        public toJSON(): { [k: string]: any };

                        /**
                         * Gets the default type url for DanmakuFlag
                         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
                         * @returns The default type url
                         */
                        public static getTypeUrl(typeUrlPrefix?: string): string;
                    }
                }
            }
        }
    }
}
