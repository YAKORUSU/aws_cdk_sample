import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';

export interface VpcStackProps extends cdk.StackProps {}

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly privateSubnets: ec2.ISubnet[];
  public readonly publicSubnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props?: VpcStackProps) {
    super(scope, id, props);

    // VPC（自動サブネットなし）
    this.vpc = new ec2.Vpc(this, 'MyVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      subnetConfiguration: [],
      natGateways: 0,
    });

    // ----- サブネット作成 -----
    // Public
    const publicSubnetA = new ec2.Subnet(this, 'PublicSubnetA', {
      vpcId: this.vpc.vpcId,
      availabilityZone: 'ap-northeast-1a',
      cidrBlock: '10.0.0.0/20',
      mapPublicIpOnLaunch: true,
    });
    const publicSubnetC = new ec2.Subnet(this, 'PublicSubnetC', {
      vpcId: this.vpc.vpcId,
      availabilityZone: 'ap-northeast-1c',
      cidrBlock: '10.0.16.0/20',
      mapPublicIpOnLaunch: true,
    });

    // Private
    const privateSubnetA = new ec2.Subnet(this, 'PrivateSubnetA', {
      vpcId: this.vpc.vpcId,
      availabilityZone: 'ap-northeast-1a',
      cidrBlock: '10.0.128.0/20',
      mapPublicIpOnLaunch: false,
    });
    const privateSubnetC = new ec2.Subnet(this, 'PrivateSubnetC', {
      vpcId: this.vpc.vpcId,
      availabilityZone: 'ap-northeast-1c',
      cidrBlock: '10.0.144.0/20',
      mapPublicIpOnLaunch: false,
    });

    // ----- VPC にサブネットを認識させる -----
    (this.vpc as any).publicSubnets.push(publicSubnetA, publicSubnetC);
    (this.vpc as any).isolatedSubnets.push(privateSubnetA, privateSubnetC);
    (this.vpc as any).privateSubnets.push(privateSubnetA, privateSubnetC);

    this.publicSubnets = [publicSubnetA, publicSubnetC];
    this.privateSubnets = [privateSubnetA, privateSubnetC];

    // ----- IGW作成・アタッチ -----
    const igw = new ec2.CfnInternetGateway(this, 'InternetGateway');
    new ec2.CfnVPCGatewayAttachment(this, 'VpcIgwAttach', {
      vpcId: this.vpc.vpcId,
      internetGatewayId: igw.ref,
    });

    // ----- ルートテーブル -----
    // Public RT
    const publicRt = new ec2.CfnRouteTable(this, 'PublicRouteTable', { vpcId: this.vpc.vpcId });
    new ec2.CfnRoute(this, 'PublicDefaultRoute', {
      routeTableId: publicRt.ref,
      destinationCidrBlock: '0.0.0.0/0',
      gatewayId: igw.ref,
    });
    new ec2.CfnSubnetRouteTableAssociation(this, 'PubSubnetA_RTA', {
      subnetId: publicSubnetA.subnetId,
      routeTableId: publicRt.ref,
    });
    new ec2.CfnSubnetRouteTableAssociation(this, 'PubSubnetC_RTA', {
      subnetId: publicSubnetC.subnetId,
      routeTableId: publicRt.ref,
    });

    // Private RT（外部アクセスなし）
    const privateRt = new ec2.CfnRouteTable(this, 'PrivateRouteTable', { vpcId: this.vpc.vpcId });
    new ec2.CfnSubnetRouteTableAssociation(this, 'PrivSubnetA_RTA', {
      subnetId: privateSubnetA.subnetId,
      routeTableId: privateRt.ref,
    });
    new ec2.CfnSubnetRouteTableAssociation(this, 'PrivSubnetC_RTA', {
      subnetId: privateSubnetC.subnetId,
      routeTableId: privateRt.ref,
    });

    // ----- S3 Gateway VPC Endpoint -----
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnets: [privateSubnetA, privateSubnetC] }],
    });

    // 出力
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'PublicSubnets', {
      value: this.publicSubnets.map(s => s.subnetId).join(','),
    });
    new cdk.CfnOutput(this, 'PrivateSubnets', {
      value: this.privateSubnets.map(s => s.subnetId).join(','),
    });
  }
}
