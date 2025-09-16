import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_iam as iam } from 'aws-cdk-lib';

interface SecurityStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class SecurityStack extends cdk.Stack {
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly ecsSecurityGroup: ec2.SecurityGroup;
  public readonly rdsSecurityGroup: ec2.SecurityGroup;
  public readonly ecsTaskRole: iam.Role;
  public readonly ecsExecutionRole: iam.Role;

  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);
    const vpc = props.vpc;

    // ALB SG (HTTPのみ、要件どおり)
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'ALB security group (HTTP)',
      allowAllOutbound: true,
    });
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP');

    // ECS SG
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc,
      description: 'ECS tasks security group',
      allowAllOutbound: true,
    });
    this.ecsSecurityGroup.addIngressRule(this.albSecurityGroup, ec2.Port.tcp(80), 'Allow ALB -> ECS');

    // RDS SG
    this.rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc,
      description: 'RDS security group',
      allowAllOutbound: true,
    });
    this.rdsSecurityGroup.addIngressRule(this.ecsSecurityGroup, ec2.Port.tcp(3306), 'Allow ECS -> RDS (MySQL)');

    // ECS task role (app が S3 等にアクセスするための role)
    this.ecsTaskRole = new iam.Role(this, 'EcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Task role for ECS tasks (app role)',
    });

    // 最小限のS3読み取り権限の例（必ず your-bucket-name を置換）
    this.ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: ['arn:aws:s3:::your-bucket-name', 'arn:aws:s3:::your-bucket-name/*'],
    }));

    // ECS execution role (タスク実行用)
    this.ecsExecutionRole = new iam.Role(this, 'EcsExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    new cdk.CfnOutput(this, 'EcsTaskRoleArn', { value: this.ecsTaskRole.roleArn });
  }
}
